import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import Database from "better-sqlite3";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

const PORT = Number(process.env.PORT || 3000);

const uploadDir = path.join(__dirname, "uploads");

fs.mkdirSync(uploadDir, {
  recursive: true
});

/* ---------------- SECURITY ---------------- */

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);

app.use(
  express.json({
    limit: "40kb"
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "20kb"
  })
);

/* ---------------- DATABASE ---------------- */

const db = new Database(
  path.join(__dirname, "unforgettable.db")
);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  names TEXT NOT NULL,
  story TEXT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,

  FOREIGN KEY(memory_id)
  REFERENCES memories(id)
  ON DELETE CASCADE
);
`);

/* ---------------- SESSIONS ---------------- */

const SQLiteStore = SQLiteStoreFactory(session);

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: __dirname
    }),

    secret:
      process.env.SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production",

      maxAge: 4 * 60 * 60 * 1000
    }
  })
);

/* ---------------- HELPERS ---------------- */

function adminRequired(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  next();
}

function clean(value, maxLength) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

/* ---------------- LOGIN LIMITER ---------------- */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  limit: 8,

  standardHeaders: "draft-8",

  legacyHeaders: false,

  message: {
    error: "Too many login attempts. Try again later."
  }
});

/* ---------------- MEMORY QUERIES ---------------- */

function getMemories(status) {
  const rows = db
    .prepare(
      `
      SELECT
        m.*,

        GROUP_CONCAT(
          media.id || '|' ||
          media.stored_name || '|' ||
          media.mime || '|' ||
          media.original_name,
          ';;'
        ) AS files

      FROM memories m

      LEFT JOIN media
      ON media.memory_id = m.id

      WHERE m.status = ?

      GROUP BY m.id

      ORDER BY
        m.year DESC,
        m.month DESC,
        m.day DESC,
        m.created_at DESC
      `
    )
    .all(status);

  return rows.map((memory) => {
    const files = String(memory.files || "")
      .split(";;")
      .filter(Boolean)
      .map((file) => {
        const [
          id,
          storedName,
          mime,
          originalName
        ] = file.split("|");

        return {
          id,

          url:
            "/media/" +
            encodeURIComponent(storedName),

          mime,

          original_name: originalName
        };
      });

    return {
      ...memory,
      files
    };
  });
}

/* ---------------- PUBLIC MEMORIES ---------------- */

app.get("/api/memories", (req, res) => {
  const memories = getMemories("approved");

  res.json(memories);
});

/* ---------------- ADMIN STATUS ---------------- */

app.get("/api/me", (req, res) => {
  res.json({
    admin: Boolean(req.session.admin)
  });
});

/* ---------------- LOGIN ---------------- */

app.post(
  "/api/login",
  loginLimiter,
  (req, res) => {
    const password = String(
      req.body.password || ""
    );

    const expected =
      process.env.ADMIN_PASSWORD || "";

    let valid = false;

    if (
      expected &&
      password.length === expected.length
    ) {
      valid = crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(expected)
      );
    }

    if (!valid) {
      return res.status(401).json({
        error: "Incorrect password."
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        return res.status(500).json({
          error:
            "Could not create secure session."
        });
      }

      req.session.admin = true;

      res.json({
        ok: true
      });
    });
  }
);

/* ---------------- LOGOUT ---------------- */

app.post(
  "/api/logout",
  adminRequired,
  (req, res) => {
    req.session.destroy(() => {
      res.json({
        ok: true
      });
    });
  }
);

/* ---------------- UPLOAD CONFIG ---------------- */

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm"
]);

const maxBytes =
  Number(process.env.MAX_UPLOAD_MB || 25) *
  1024 *
  1024;

const storage = multer.diskStorage({
  destination: uploadDir,

  filename: (req, file, callback) => {
    const extension =
      path.extname(file.originalname)
        .toLowerCase();

    callback(
      null,
      crypto.randomUUID() + extension
    );
  }
});

const upload = multer({
  storage,

  limits: {
    files: 20,

    fileSize: maxBytes
  },

  fileFilter: (req, file, callback) => {
    callback(
      null,
      allowedTypes.has(file.mimetype)
    );
  }
});

/* ---------------- SUBMIT MEMORY ---------------- */

app.post(
  "/api/memories",
  upload.array("files", 20),
  (req, res) => {
    const title = clean(
      req.body.title,
      120
    );

    const names = clean(
      req.body.names,
      300
    );

    const story = clean(
      req.body.story,
      2500
    );

    const date = clean(
      req.body.date,
      10
    );

    const parts = date
      .split("-")
      .map(Number);

    const year = parts[0];
    const month = parts[1];
    const day = parts[2];

    if (
      !title ||
      !names ||
      !year ||
      !month ||
      !day ||
      !req.files ||
      req.files.length === 0
    ) {
      for (const file of req.files || []) {
        fs.unlink(file.path, () => {});
      }

      return res.status(400).json({
        error:
          "Title, names, date and at least one file are required."
      });
    }

    const memoryId =
      crypto.randomUUID();

    const now =
      new Date().toISOString();

    const transaction =
      db.transaction(() => {
        db.prepare(
          `
          INSERT INTO memories (
            id,
            title,
            names,
            story,
            year,
            month,
            day,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          memoryId,
          title,
          names,
          story,
          year,
          month,
          day,
          "pending",
          now
        );

        for (const file of req.files) {
          db.prepare(
            `
            INSERT INTO media (
              id,
              memory_id,
              original_name,
              stored_name,
              mime,
              size,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          ).run(
            crypto.randomUUID(),
            memoryId,
            file.originalname,
            file.filename,
            file.mimetype,
            file.size,
            now
          );
        }
      });

    transaction();

    res.status(201).json({
      ok: true,

      message:
        "Memory submitted for admin approval."
    });
  }
);

/* ---------------- PENDING MEMORIES ---------------- */

app.get(
  "/api/pending",
  adminRequired,
  (req, res) => {
    res.json(
      getMemories("pending")
    );
  }
);

/* ---------------- APPROVE ---------------- */

app.post(
  "/api/memories/:id/approve",
  adminRequired,
  (req, res) => {
    db.prepare(
      `
      UPDATE memories
      SET status = 'approved'
      WHERE id = ?
      `
    ).run(req.params.id);

    res.json({
      ok: true
    });
  }
);

/* ---------------- DELETE ---------------- */

app.delete(
  "/api/memories/:id",
  adminRequired,
  (req, res) => {
    const files = db
      .prepare(
        `
        SELECT stored_name
        FROM media
        WHERE memory_id = ?
        `
      )
      .all(req.params.id);

    db.prepare(
      `
      DELETE FROM media
      WHERE memory_id = ?
      `
    ).run(req.params.id);

    db.prepare(
      `
      DELETE FROM memories
      WHERE id = ?
      `
    ).run(req.params.id);

    for (const file of files) {
      fs.unlink(
        path.join(
          uploadDir,
          file.stored_name
        ),
        () => {}
      );
    }

    res.json({
      ok: true
    });
  }
);

/* ---------------- MEDIA ---------------- */

app.get(
  "/media/:name",
  (req, res) => {
    const name = path.basename(
      req.params.name
    );

    const media = db
      .prepare(
        `
        SELECT mime
        FROM media
        WHERE stored_name = ?
        `
      )
      .get(name);

    if (!media) {
      return res.sendStatus(404);
    }

    const filePath =
      path.join(uploadDir, name);

    if (!fs.existsSync(filePath)) {
      return res.sendStatus(404);
    }

    res.type(media.mime);

    res.sendFile(filePath);
  }
);

/* ---------------- FRONTEND ---------------- */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* ---------------- START ---------------- */

app.listen(
  PORT,
  () => {
    console.log(
      `Unforgettable Memories running at http://localhost:${PORT}`
    );
  }
);