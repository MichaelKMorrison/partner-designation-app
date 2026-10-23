const pLimit = require("p-limit").default;

const PARTNER_DIRECTORY_BASE_URL = "https://main.prod.marketplacepartnerdirectory.azure.com";
const DEFAULT_PAGE_SIZE = 18;
const DEFAULT_MAX_PAGES = 12;

const designationLabels = {
  AzureDataAICompetency: "Data & AI (Azure)",
  AzureInfraCompetency: "Infrastructure (Azure)",
  BizAppsCompetency: "Business Applications",
  ModernCompetency: "Modern Work",
  SecurityCompetency: "Security",
  DigitalAppInnovationCompetency: "Digital & App Innovation (Azure)",
};

function toReadableDesignation(code) {
  return designationLabels[code] || code;
}

function toCsv(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }

  return values.join(",");
}

function buildFilterQuery({ freeText, pageOffset = 0, pageSize = DEFAULT_PAGE_SIZE, designations = [] }) {
  const parts = [
    "sort=0",
    `pageSize=${pageSize}`,
    `pageOffset=${pageOffset}`,
    "onlyThisCountry=true",
    "radius=100",
    "locationNotRequired=true",
  ];

  if (freeText) {
    parts.push(`freetext=${freeText}`);
  }

  if (designations.length > 0) {
    parts.push(`designations=${toCsv(designations)}`);
  }

  return parts.join(";");
}

async function fetchPartnersPage({ freeText, pageOffset, pageSize, designations }) {
  const filter = buildFilterQuery({ freeText, pageOffset, pageSize, designations });
  const url = `${PARTNER_DIRECTORY_BASE_URL}/api/partners?filter=${encodeURIComponent(filter)}`;
  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    throw new Error(`Partner directory request failed with status ${response.status}`);
  }

  return response.json();
}

function transformPartner(partner) {
  const solutionDesignations = partner.solutionsPartnerDesignations || [];
  const supportDesignations = partner.supportServicesDesignations || [];
  const trainingDesignations = partner.trainingServicesPartnerDesignations || [];
  const allDesignations = [...solutionDesignations, ...supportDesignations, ...trainingDesignations];

  return {
    partnerId: partner.partnerId || "",
    partnerRecordId: partner.id || "",
    partnerName: partner.name || "",
    location: partner.location || "",
    solutionsPartnerDesignations: solutionDesignations,
    solutionsPartnerDesignationNames: solutionDesignations.map(toReadableDesignation),
    supportServicesDesignations: supportDesignations,
    trainingServicesPartnerDesignations: trainingDesignations,
    allDesignations,
    designationCount: allDesignations.length,
  };
}

function pickBestMatch(customerName, matches) {
  if (matches.length === 0) {
    return null;
  }

  const normalizedNeedle = customerName.trim().toLowerCase();
  const exact = matches.find((match) => match.partnerName.trim().toLowerCase() === normalizedNeedle);
  if (exact) {
    return exact;
  }

  const startsWith = matches.find((match) => match.partnerName.trim().toLowerCase().startsWith(normalizedNeedle));
  if (startsWith) {
    return startsWith;
  }

  return matches[0];
}

async function fetchMatchesForCustomer(customerName, options) {
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages || DEFAULT_MAX_PAGES;
  const designations = options.designations || [];

  let pageOffset = 0;
  let pageNumber = 0;
  let estimatedTotal = Number.MAX_SAFE_INTEGER;
  const deduped = new Map();

  while (pageNumber < maxPages) {
    const page = await fetchPartnersPage({
      freeText: customerName,
      pageOffset,
      pageSize,
      designations,
    });

    const items = page?.matchingPartners?.items || [];
    estimatedTotal = Number(page?.estimatedTotalMatchingPartners || estimatedTotal);

    for (const item of items) {
      if (!deduped.has(item.partnerId)) {
        deduped.set(item.partnerId, transformPartner(item));
      }
    }

    if (items.length < pageSize || deduped.size >= estimatedTotal) {
      break;
    }

    pageOffset += items.length;
    pageNumber += 1;
  }

  const matches = [...deduped.values()];
  return {
    customerName,
    status: matches.length > 0 ? "matched" : "no_match",
    bestMatch: pickBestMatch(customerName, matches),
    matchCount: matches.length,
    matches,
  };
}

async function lookupCustomers(customers, options = {}) {
  const uniqueCustomers = [...new Set(customers.map((name) => name.trim()).filter(Boolean))];
  const limit = pLimit(options.concurrency || 4);

  const tasks = uniqueCustomers.map((customerName) =>
    limit(async () => {
      try {
        return await fetchMatchesForCustomer(customerName, options);
      } catch (error) {
        return {
          customerName,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          bestMatch: null,
          matchCount: 0,
          matches: [],
        };
      }
    }),
  );

  return Promise.all(tasks);
}

module.exports = {
  designationLabels,
  lookupCustomers,
  toReadableDesignation,
};
