import "dotenv/config";
import express from "express";
import cors from "cors";

import healthRouter from "./routes/health";
import dbtestRouter from "./routes/dbtest";
import recibosRouter from "./routes/recibos";
import uploadRouter from "./routes/upload";
import path from "path";
import usersRouter from "./routes/users";

const app = express();

// Middlewares base
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (HTML/CSS/JS) desde /public
// Ej: public/index.html -> http://localhost:4000/
app.use(express.static("public"));

// Montar routers bajo /api
app.use("/api", healthRouter);
app.use("/api", dbtestRouter);
app.use("/api", recibosRouter);
app.use("/api", uploadRouter);
app.use(express.static(path.resolve(process.cwd(), "public")));
app.use("/api/users", usersRouter);

// 404 controlado (solo para rutas que no sean archivos estáticos)
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

