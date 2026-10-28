import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.log("Atlas ping: MONGODB_URI is missing");
  process.exitCode = 2;
} else {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    await client.db(process.env.MONGODB_DB_NAME || undefined).command({ ping: 1 });
    console.log("Atlas ping: connected successfully");
  } catch (error) {
    console.log(`Atlas ping: failed (${error?.name || "Error"}; ${error?.code || "no-code"})`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}
