/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Role authorization middleware factory.
 * - Ensures `req.user.role` matches the required role.
 * Why: Enforces protected admin/user routes.
 * Related: `auth.js` must run before this to populate `req.user`.
 */

export function requireRole(requiredRole) {
  return function roleGuard(req, res, next) {
    // Ensure authentication middleware ran first
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== requiredRole) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }

    next();
  };
}


