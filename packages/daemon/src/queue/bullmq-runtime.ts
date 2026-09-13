import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_NAMES } from "../orchestrator/workers.js";

export type InjectJobOp = "drain-tick" | "inbox-row" | "peer-row";

export interface InjectJobData {
  op: InjectJobOp;
  rowId?: string;
}

export interface BullmqRuntime {
  connection: Redis;
  injectQueue: Queue<InjectJobData>;
  injectWorker: Worker<InjectJobData>;
  close: () => Promise<void>;
}

/** Returns null when Redis is unreachable (host poll loop remains the fallback). */
export async function startBullmqRuntime(
  redisUrl: string,
  processor: (job: InjectJobData) => Promise<void>,
  log: (line: string) => void,
): Promise<BullmqRuntime | null> {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 2500,
    lazyConnect: true,
  });

  try {
    await connection.connect();
    await connection.ping();
  } catch (e) {
    log(`BULLMQ skipped (redis unreachable): ${(e as Error).message}`);
    try {
      await connection.quit();
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    const injectQueue = new Queue<InjectJobData>(QUEUE_NAMES.inject, {
      connection: connection as ConnectionOptions,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 8,
        backoff: { type: "fixed", delay: 2000 },
      },
    });

    const injectWorker = new Worker<InjectJobData>(
      QUEUE_NAMES.inject,
      async (job) => {
        await processor(job.data);
      },
      {
        connection: connection as ConnectionOptions,
        concurrency: 1,
      },
    );

    injectWorker.on("failed", (job, err) => {
      if (job?.data?.op) {
        log(`BULLMQ fail op=${job.data.op} ${err.message}`);
      }
    });

    log(`BULLMQ connected ${redisUrl} queue=${QUEUE_NAMES.inject}`);

    return {
      connection,
      injectQueue,
      injectWorker,
      close: async () => {
        await injectWorker.close();
        await injectQueue.close();
        await connection.quit();
      },
    };
  } catch (e) {
    log(`BULLMQ init failed: ${(e as Error).message}`);
    try {
      await connection.quit();
    } catch {
      /* ignore */
    }
    return null;
  }
}

export async function enqueueDrainTick(queue: Queue<InjectJobData>): Promise<void> {
  await queue.add(
    "drain-tick",
    { op: "drain-tick" },
    { jobId: `drain-tick-${Date.now()}`, removeOnComplete: true },
  );
}

export async function enqueueInboxRow(queue: Queue<InjectJobData>, rowId: string): Promise<void> {
  await queue.add("inbox-row", { op: "inbox-row", rowId }, { jobId: `inbox-${rowId}` });
}

export async function enqueuePeerRow(queue: Queue<InjectJobData>, rowId: string): Promise<void> {
  await queue.add("peer-row", { op: "peer-row", rowId }, { jobId: `peer-${rowId}` });
}
