const XLSX = require("xlsx");

function readCustomerNamesFromWorkbook(buffer, columnName) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("Workbook has no sheets.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error("Workbook must include a header row and at least one data row.");
  }

  const headerRow = matrix[0].map((value) => String(value || "").trim());
  let columnIndex = 0;

  if (columnName) {
    columnIndex = headerRow.findIndex(
      (header) => header.localeCompare(columnName, undefined, { sensitivity: "accent" }) === 0,
    );

    if (columnIndex < 0) {
      throw new Error(`Column "${columnName}" not found. Available columns: ${headerRow.join(", ")}`);
    }
  }

  const names = matrix
    .slice(1)
    .map((row) => String(row[columnIndex] || "").trim())
    .filter(Boolean);

  if (names.length === 0) {
    throw new Error("No customer names found in the selected column.");
  }

  return {
    sheetName: firstSheetName,
    columnName: headerRow[columnIndex] || "Column1",
    names,
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

function buildWorkbookBuffer(results) {
  const workbook = XLSX.utils.book_new();
  const detailedRows = flattenResults(results);
  const summaryRows = results.map((result) => ({
    customerName: result.customerName,
    status: result.status,
    matchCount: result.matchCount,
    bestMatch: result.bestMatch?.partnerName || "",
    bestMatchDesignationCount: result.bestMatch?.designationCount || 0,
    error: result.error || "",
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  const detailSheet = XLSX.utils.json_to_sheet(detailedRows);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Matches");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  buildWorkbookBuffer,
  readCustomerNamesFromWorkbook,
};
