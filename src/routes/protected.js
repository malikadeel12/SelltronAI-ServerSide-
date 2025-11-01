import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Demonstrates role-protected routes for user and admin.
 * Why: Project requires protected routes with user/admin roles.
 * Related: `requireAuth` verifies token; `requireRole` enforces roles.
 */

const router = Router();

// Public test
router.get("/public", (req, res) => {
  res.json({ message: "Public endpoint accessible by anyone" });
});

// User-protected route
router.get("/user", requireAuth, (req, res) => {
  res.json({ message: "Hello user", user: { uid: req.user.uid, role: req.user.role } });
});

// Admin-only route
router.get("/admin", requireAuth, requireRole("admin"), (req, res) => {
  res.json({ message: "Hello admin", user: { uid: req.user.uid, role: req.user.role } });
});

export default router;

