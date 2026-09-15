import { Command } from "commander";
import path from "node:path";
import {
  CURRENT_ROLE_PACK_VERSION,
  inspectRolePack,
  listRoleMigrateSteps,
  loadProfile,
  runRolePackMigrate,
  type LoadedProfile,
} from "@seat-mesh/core";
import { roleTemplatesDir } from "../setup/init.js";

function rolesDirOf(loaded: LoadedProfile): string {
  return path.join(loaded.profileDir, "roles");
}

/**
 * Role-pack status + migrate up/down (1.1.x).
 * `seatmesh update` also auto-migrates to the current pack.
 */
export function buildRolesCommands(getLoaded: () => LoadedProfile): Command {
  const roles = new Command("roles").description(
    "Role-pack status and migrate (locked _vendor + *.extend.yaml)",
  );

  roles
    .command("status")
    .description("Show installed role-pack version vs engine target")
    .action(() => {
      const loaded = getLoaded();
      const st = inspectRolePack(rolesDirOf(loaded));
      console.log(`roles_dir=${st.rolesDir}`);
      console.log(`role_pack_installed=${st.installed ?? "none"}`);
      console.log(`role_pack_target=${st.target}`);
      console.log(`needs_migrate=${st.needsMigrate}`);
      console.log(`has_vendor=${st.hasVendor}`);
      console.log(`has_legacy_flat=${st.hasLegacyFlat}`);
      console.log(`extend=${st.extendFiles.join(",") || "none"}`);
      if (st.missingVendor.length) {
        console.log(`missing_vendor=${st.missingVendor.join(",")}`);
      }
      if (st.missingDocs.length) {
        console.log(`missing_docs=${st.missingDocs.join(",")}`);
      }
      console.log(`hint=seatmesh roles migrate   # up to ${CURRENT_ROLE_PACK_VERSION}`);
      console.log(`hint=seatmesh roles migrate --to 1.0.0   # down (flatten)`);
    });

  roles
    .command("migrate")
    .description("Migrate role-pack up or down (default: up to current)")
    .option("--to <version>", "target pack version", CURRENT_ROLE_PACK_VERSION)
    .option("--dry-run", "print plan only")
    .action((opts: { to: string; dryRun?: boolean }) => {
      const loaded = getLoaded();
      const result = runRolePackMigrate({
        rolesDir: rolesDirOf(loaded),
        templateRolesDir: roleTemplatesDir(),
        to: opts.to,
        dryRun: Boolean(opts.dryRun),
        log: (line) => console.log(line),
      });
      console.log(
        `OK: role-pack ${result.direction} ${result.from ?? "none"} → ${result.to}` +
          (result.steps.length ? ` steps=${result.steps.join(",")}` : " (noop)"),
      );
      if (opts.dryRun) console.log(`dry-run touched would be ${result.touched.length} paths`);
      else if (result.touched.length) {
        console.log(`touched=${result.touched.length}`);
      }
    });

  roles
    .command("steps")
    .description("List registered role-pack migrate steps")
    .action(() => {
      for (const s of listRoleMigrateSteps()) {
        console.log(`${s.from} → ${s.to}  ${s.description}`);
      }
    });

  return roles;
}

/** For tests / scripting without commander. */
export function rolesStatusLines(profileArg?: string): string[] {
  const loaded = loadProfile(profileArg);
  const st = inspectRolePack(rolesDirOf(loaded));
  return [
    `role_pack_installed=${st.installed ?? "none"}`,
    `role_pack_target=${st.target}`,
    `needs_migrate=${st.needsMigrate}`,
  ];
}
