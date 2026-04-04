import http from "http";
import "dotenv/config";
import app from "./app.js";

const basePort = Number(process.env.PORT) || 3000;
const maxAttempts = 15;

function listen(port, attempt) {
  const server = http.createServer(app);
  server.listen(port, () => {
    if (port !== basePort) {
      console.warn(`(Puerto ${basePort} estaba ocupado; se usó ${port}.)`);
    }
    console.log(`Servidor en http://localhost:${port}`);
    console.log(`Admin: http://localhost:${port}/admin`);
    if (process.env.DATABASE_URL) {
      console.log("Base de datos: Neon (PostgreSQL) vía DATABASE_URL.");
    } else {
      console.log(
        "Sin DATABASE_URL: usando SQLite local (data/payments.db). Para igualar producción, crea un .env con la URI de Neon."
      );
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < maxAttempts) {
      listen(port + 1, attempt + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

listen(basePort, 0);
