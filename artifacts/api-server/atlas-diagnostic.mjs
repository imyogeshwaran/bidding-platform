import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000
});

try {
  await client.connect();
  await client.db(process.env.MONGODB_DB_NAME || "bidding_platform")
    .command({ ping: 1 });

  console.log("Atlas ping succeeded");
} catch (e) {
  console.log("Error:", e.name);
  console.log("Message:", e.message);
  console.log("Cause:", e.cause?.message || "none");

  if (e.reason?.servers) {
    for (const [host, info] of e.reason.servers) {
      console.log("Server:", host);
      console.log("Server error:", info.error?.message || "none");
    }
  }

  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
