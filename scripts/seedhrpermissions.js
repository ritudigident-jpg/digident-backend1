/**
 * Creates the permissions used by the attendance / leave / payroll / employee-profile endpoints
 * (constants/permissions.constant.js) and gives them to every Super Admin and Admin, the same way
 * POST /api/v1/permission/create does. Safe to run again.
 *
 *   node scripts/seedhrpermissions.js            dry run
 *   node scripts/seedhrpermissions.js --apply    saves
 *
 * Other roles get them through the Permissions screen (Access Manager).
 */
import "dotenv/config";
import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
import Permission from "../src/models/permission.model.js";
import Employee from "../src/models/employee.model.js";
import { PERMISSIONS, ROLES } from "../src/constants/permissions.constant.js";

const APPLY = process.argv.includes("--apply");
const URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const log = (text) => process.stdout.write(`${text}\n`);

const run = async () => {
  if (!URI) throw new Error("Set MONGODB_URI");
  await mongoose.connect(URI);
  const owner = await Employee.findOne({ role: ROLES.SUPER_ADMIN, isDeleted: false }).select("_id email").lean();
  if (!owner) throw new Error("No Super Admin found to own the permissions");
  const names = Object.values(PERMISSIONS);
  const existing = new Set((await Permission.find({ name: { $in: names } }).select("name").lean()).map((p) => p.name));
  const missing = names.filter((name) => !existing.has(name));
  log(`${APPLY ? "APPLY" : "DRY RUN"}: ${missing.length} permission(s) to create: ${missing.join(", ") || "none"}`);
  if (APPLY) {
    for (const name of missing) await Permission.create({ name, permissionId: uuidv6(), createdBy: owner._id });
    const result = await Employee.updateMany(
      { role: { $in: [ROLES.SUPER_ADMIN, ROLES.ADMIN] } },
      { $addToSet: { permissions: { $each: names } } }
    );
    log(`Assigned to ${result.modifiedCount} Super Admin / Admin account(s).`);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  process.stderr.write(`Seed failed: ${error.message}\n`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
