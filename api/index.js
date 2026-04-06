/**
 * Vercel invoca la app Express directamente (ver guía oficial).
 * No usar serverless-http aquí: en Vercel puede romper cookies/sesión y POST.
 */
import app from "../app.js";

export default app;
