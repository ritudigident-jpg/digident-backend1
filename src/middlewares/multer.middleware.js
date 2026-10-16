/**
 * File upload settings (multer): general uploads and Excel imports.
 *
 * Exports: uploadExcel, uploadDocument
 * Used by: 8 files, e.g. routes/banners.routes.js, routes/blogs.routes.js,
 * routes/brands.routes.js, routes/careers.routes.js
 */

import multer from "multer";

/**
 * @module upload
 *
 * @description
 * Multer middleware for handling file uploads.
 * Stores files on disk using original filename.
 *
 * @process
 * 1. Configure disk storage with `multer.diskStorage`
 * 2. Use `originalname` for stored file names
 * 3. Export configured multer instance for route use
 *
 * @example
 * router.post("/upload", upload.single("file"), controllerFunction);
 */
const storage = multer.diskStorage({
  filename: (req, file, callback) => {
    callback(null, file.originalname);
  },
});

const upload = multer({ storage });
export default upload;

export const uploadExcel = multer({
  storage: multer.memoryStorage(), // file lives at req.file.buffer
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max

  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
      "text/csv", // .csv
      "application/csv",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only .xlsx, .xls or .csv files are accepted"), false);
  },
});

/**
 * Employee documents: one file in memory (req.file.buffer), at most 5 MB. The declared type is
 * only a first filter; the real type is checked from the bytes in employeedocument.service.js.
 */
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"), false);
  },
});
