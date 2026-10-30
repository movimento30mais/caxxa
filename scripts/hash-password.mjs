// Gera uma entrada para AUTH_USERS: node scripts/hash-password.mjs <usuario> <senha>
import { randomBytes, scryptSync } from "node:crypto";

const [user, password] = process.argv.slice(2);
if (!user || !password) {
  console.error("Uso: npm run hash-password -- <usuario> <senha>");
  process.exit(1);
}
const salt = randomBytes(16).toString("base64url");
console.log(`${user.toLowerCase()}:scrypt$${salt}$${scryptSync(password, salt, 32).toString("base64url")}`);
