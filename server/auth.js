const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: "30d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Log in to continue." });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "Your session expired. Log in again." });
  }
}

module.exports = { signToken, authMiddleware };
