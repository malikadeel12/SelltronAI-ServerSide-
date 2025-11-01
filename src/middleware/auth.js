import { adminAuth } from "../config/firebaseAdmin.js";

/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Middleware to verify Firebase ID token from Authorization header.
 * - Attaches decoded token and derived role to `req.user` for downstream use.
 * Why: Needed to protect routes and support role-based access.
 * Related: `roles.js` for role checks; expects `role` custom claim on token.
 */

// --- Authentication Middleware ---
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    // Don't force revoked check to avoid unnecessary failures on fresh logins
    const decoded = await adminAuth.verifyIdToken(token);

    // Derive role from custom claim if present; default to "user"
    const role = decoded.role || (decoded.claims && decoded.claims.role) || "user";

    // Attach to request for downstream middleware/handlers
    req.user = { ...decoded, role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

