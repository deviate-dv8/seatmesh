# Isolated seatmesh CI runner — build/typecheck/vitest only. Not the upgrade lab
# (../lab): that drills `npm i -g seatmesh`. This image runs THIS checkout's suite
# in a container so it never touches host tmux panes, ~/.config/zsign, or the
# host's own .sm/ mesh state, even though some tests spawn the real `tmux` binary
# against panes that intentionally don't exist (see authz-guard/resume-extract tests).
FROM node:22-bookworm

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
    tmux \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Dependency layer cached separately from source so a source-only change doesn't
# re-run npm ci. Workspaces need every package.json present before install.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/tmux/package.json packages/tmux/package.json
COPY packages/connectivity/package.json packages/connectivity/package.json
COPY packages/daemon/package.json packages/daemon/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY . .

ENV CI=1 \
    SEATMESH_SKIP_VERSION_CHECK=1

ENTRYPOINT ["/work/test/docker/entrypoint.sh"]
CMD ["test"]
