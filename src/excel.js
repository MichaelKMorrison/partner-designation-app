const path = require("path");

const { parse } = require("csv-parse/sync");
const readXlsxFile = require("read-excel-file/node");
const writeXlsxFile = require("write-excel-file/node");

function resolveColumnIndex(headerRow, columnName) {
  if (!columnName) {
    return 0;
  }

  const index = headerRow.findIndex(
    (header) => header.localeCompare(columnName, undefined, { sensitivity: "accent" }) === 0,
  );

  if (index < 0) {
    throw new Error(`Column "${columnName}" not found. Available columns: ${headerRow.join(", ")}`);
  }

  return index;
}

function parseCustomerNamesFromMatrix(matrix, columnName) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error("File must include a header row and at least one data row.");
  }

  const headerRow = matrix[0].map((value) => String(value ?? "").trim());
  const columnIndex = resolveColumnIndex(headerRow, columnName);

  const names = matrix
    .slice(1)
    .map((row) => String(row[columnIndex] ?? "").trim())
    .filter(Boolean);

  if (names.length === 0) {
    throw new Error("No customer names found in the selected column.");
  }

  return {
    columnName: headerRow[columnIndex] || "Column1",
    names,
  };
}

function toCell(value) {
  if (typeof value === "number") {
    return { type: Number, value };
  }

  return { type: String, value: String(value ?? "") };
}

async function readCustomerNamesFromWorkbook(buffer, columnName, fileName = "") {
  const extension = path.extname(fileName).toLowerCase();
  let matrix;
  let sheetName = "Sheet1";

  if (extension === ".csv") {
    const parsed = parse(buffer.toString("utf8"), {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
    matrix = parsed;
    sheetName = "CSV";
  } else {
    matrix = await readXlsxFile(buffer);
  }

  const parsed = parseCustomerNamesFromMatrix(matrix, columnName);
  return {
    sheetName,
    columnName: parsed.columnName,
    names: parsed.names,
  };
}

function flattenResults(results) {
  const rows = [];

  for (const result of results) {
    if (result.matches.length === 0) {
      rows.push({
        customerName: result.customerName,
        status: result.status,
        partnerName: "",
        partnerId: "",
        location: "",
        solutionsPartnerDesignations: "",
        solutionsPartnerDesignationNames: "",
        supportServicesDesignations: "",
        trainingServicesPartnerDesignations: "",
        designationCount: 0,
      });
      continue;
    }

    for (const match of result.matches) {
      rows.push({
        customerName: result.customerName,
        status: result.status,
        partnerName: match.partnerName,
        partnerId: match.partnerId,
        location: match.location,
        solutionsPartnerDesignations: match.solutionsPartnerDesignations.join(" | "),
        solutionsPartnerDesignationNames: match.solutionsPartnerDesignationNames.join(" | "),
        supportServicesDesignations: match.supportServicesDesignations.join(" | "),
        trainingServicesPartnerDesignations: match.trainingServicesPartnerDesignations.join(" | "),
        designationCount: match.designationCount,
      });
    }
  }

  return rows;
}

function toSheetRows(objects) {
  if (objects.length === 0) {
    return [[toCell("No data")]];
  }

  const headers = Object.keys(objects[0]);
  const headerRow = headers.map((header) => toCell(header));
  const valueRows = objects.map((item) => headers.map((header) => toCell(item[header])));
  return [headerRow, ...valueRows];
}

async function buildWorkbookBuffer(results) {
  const detailedRows = flattenResults(results);
  const summaryRows = results.map((result) => ({
    customerName: result.customerName,
    status: result.status,
    matchCount: result.matchCount,
    bestMatch: result.bestMatch?.partnerName || "",
    bestMatchDesignationCount: result.bestMatch?.designationCount || 0,
    error: result.error || "",
  }));

  const workbook = writeXlsxFile(
    [
      {
        sheet: "Summary",
        data: toSheetRows(summaryRows),
      },
      {
        sheet: "Matches",
        data: toSheetRows(detailedRows),
      },
    ],
  );

  return workbook.toBuffer();
}

module.exports = {
  buildWorkbookBuffer,
  readCustomerNamesFromWorkbook,
};
