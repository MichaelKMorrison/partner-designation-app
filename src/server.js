const path = require("path");

const express = require("express");
const multer = require("multer");

const { buildWorkbookBuffer, readCustomerNamesFromWorkbook } = require("./excel");
const { designationLabels, lookupCustomers } = require("./partnerDirectoryClient");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

function parseCustomerList(rawCustomers) {
  if (!Array.isArray(rawCustomers)) {
    throw new Error("customers must be an array of names.");
  }

  const names = rawCustomers.map((name) => String(name || "").trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error("customers must contain at least one non-empty name.");
  }

  if (names.length > 2000) {
    throw new Error("customers list is too large. Maximum is 2000 names per request.");
  }

  return names;
}

function parseDesignationFilter(rawDesignations) {
  if (!rawDesignations) {
    return [];
  }

  if (Array.isArray(rawDesignations)) {
    return rawDesignations.map((value) => String(value).trim()).filter(Boolean);
  }

  return String(rawDesignations)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function shouldExportXlsx(req) {
  return String(req.query.output || req.body.outputFormat || "").toLowerCase() === "xlsx";
}

async function sendXlsx(res, results) {
  const workbookBuffer = await buildWorkbookBuffer(results);
  const fileName = `partner-designations-${Date.now()}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(workbookBuffer);
}

async function runLookup(customerNames, designationFilter) {
  const results = await lookupCustomers(customerNames, { designations: designationFilter });
  const completedAt = new Date().toISOString();
  return {
    completedAt,
    customerCount: customerNames.length,
    uniqueCustomerCount: new Set(customerNames.map((name) => name.toLowerCase())).size,
    designationFilter,
    results,
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "partner-designation-app",
    designationFilterKeys: Object.keys(designationLabels),
  });
});

app.post("/api/lookup", async (req, res) => {
  try {
    const customers = parseCustomerList(req.body.customers);
    const designationFilter = parseDesignationFilter(req.body.designations);
    const payload = await runLookup(customers, designationFilter);

    if (shouldExportXlsx(req)) {
      await sendXlsx(res, payload.results);
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/lookup/file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ error: "Missing file upload. Use multipart form field name: file" });
      return;
    }

    const designationFilter = parseDesignationFilter(req.body.designations);
    const parsed = await readCustomerNamesFromWorkbook(req.file.buffer, req.body.columnName, req.file.originalname);
    const payload = await runLookup(parsed.names, designationFilter);
    payload.input = {
      mode: "file",
      fileName: req.file.originalname,
      sheetName: parsed.sheetName,
      columnName: parsed.columnName,
    };

    if (shouldExportXlsx(req)) {
      await sendXlsx(res, payload.results);
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Partner designation app listening on http://localhost:${port}`);
});
