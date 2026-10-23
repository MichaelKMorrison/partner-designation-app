const textForm = document.getElementById("text-form");
const fileForm = document.getElementById("file-form");
const downloadJsonButton = document.getElementById("download-json");
const downloadXlsxFromTextButton = document.getElementById("download-xlsx-from-text");
const downloadXlsxFromFileButton = document.getElementById("download-xlsx-from-file");
const statusEl = document.getElementById("status");
const tableBody = document.querySelector("#results-table tbody");

let latestPayload = null;

function parseDesignations(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "var(--cp-danger)" : "var(--cp-text-muted)";
}

function resetTable() {
  tableBody.innerHTML = "";
}

function appendCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value ?? "";
  row.appendChild(td);
}

function renderResults(payload) {
  latestPayload = payload;
  resetTable();

  payload.results.forEach((result) => {
    const match = result.bestMatch;
    const tr = document.createElement("tr");
    appendCell(tr, result.customerName);
    appendCell(tr, result.status);
    appendCell(
      tr,
      (match?.solutionsPartnerDesignationNames || match?.solutionsPartnerDesignations || []).join(" | "),
    );
    appendCell(tr, (match?.supportServicesDesignations || []).join(" | "));
    appendCell(tr, (match?.trainingServicesPartnerDesignations || []).join(" | "));
    tableBody.appendChild(tr);
  });

  const matched = payload.results.filter((result) => result.status === "matched").length;
  const noExact = payload.results.filter((result) => result.status === "no_exact_match").length;
  setStatus(
    `Done. Processed ${payload.customerCount} inputs (${payload.uniqueCustomerCount} unique). Exact matches for ${matched}. No exact match for ${noExact}.`,
  );
  downloadJsonButton.disabled = false;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function triggerBlobDownload(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

async function requestXlsx(url, options, fallbackFileName) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Export failed (${response.status})`);
  }

  const contentDisposition = response.headers.get("content-disposition") || "";
  const nameMatch = /filename=\"([^\"]+)\"/i.exec(contentDisposition);
  const fileName = nameMatch?.[1] || fallbackFileName;
  const blob = await response.blob();
  triggerBlobDownload(blob, fileName);
}

textForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Running lookup...");

  const customerNames = document
    .getElementById("customerNames")
    .value.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const designations = parseDesignations(document.getElementById("designationFilter").value || "");
  const includeAllMatches = document.getElementById("includeAllMatches").checked;

  try {
    const payload = await fetchJson("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customers: customerNames, designations, includeAllMatches }),
    });
    renderResults(payload);
  } catch (error) {
    setStatus(error.message, true);
  }
});

fileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Running file lookup...");

  const fileInput = document.getElementById("file");
  const columnName = document.getElementById("columnName").value.trim();
  const designations = document.getElementById("designationFilterFile").value.trim();
  const includeAllMatches = document.getElementById("includeAllMatchesFile").checked;
  const file = fileInput.files[0];

  if (!file) {
    setStatus("Select a file first.", true);
    return;
  }

  const formData = new FormData();
  formData.set("file", file);
  if (columnName) {
    formData.set("columnName", columnName);
  }
  if (designations) {
    formData.set("designations", designations);
  }
  formData.set("includeAllMatches", String(includeAllMatches));

  try {
    const payload = await fetchJson("/api/lookup/file", {
      method: "POST",
      body: formData,
    });
    renderResults(payload);
  } catch (error) {
    setStatus(error.message, true);
  }
});

downloadJsonButton.addEventListener("click", () => {
  if (!latestPayload) {
    return;
  }

  const blob = new Blob([JSON.stringify(latestPayload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  triggerBlobDownload(blob, `partner-designations-${Date.now()}.json`);
});

downloadXlsxFromTextButton.addEventListener("click", async () => {
  const customerNames = document
    .getElementById("customerNames")
    .value.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const designations = parseDesignations(document.getElementById("designationFilter").value || "");
  const includeAllMatches = document.getElementById("includeAllMatches").checked;

  if (customerNames.length === 0) {
    setStatus("Add at least one customer name before exporting.", true);
    return;
  }

  try {
    await requestXlsx(
      "/api/lookup?output=xlsx",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers: customerNames, designations, includeAllMatches }),
      },
      "partner-designations.xlsx",
    );
    setStatus("Excel export downloaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

downloadXlsxFromFileButton.addEventListener("click", async () => {
  const fileInput = document.getElementById("file");
  const columnName = document.getElementById("columnName").value.trim();
  const designations = document.getElementById("designationFilterFile").value.trim();
  const includeAllMatches = document.getElementById("includeAllMatchesFile").checked;
  const file = fileInput.files[0];

  if (!file) {
    setStatus("Select a file before exporting.", true);
    return;
  }

  const formData = new FormData();
  formData.set("file", file);
  formData.set("outputFormat", "xlsx");
  if (columnName) {
    formData.set("columnName", columnName);
  }
  if (designations) {
    formData.set("designations", designations);
  }
  formData.set("includeAllMatches", String(includeAllMatches));

  try {
    await requestXlsx("/api/lookup/file", { method: "POST", body: formData }, "partner-designations.xlsx");
    setStatus("Excel export downloaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
});
