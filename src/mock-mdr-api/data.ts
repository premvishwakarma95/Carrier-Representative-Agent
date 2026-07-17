/**
 * In-memory mock of the MDR system's data — stands in for the real MDR API
 * described in Everly_MDR_API_Workload_Timeline_Estimation.pdf until the
 * client builds and confirms it. Resets on process restart, or via
 * POST /mock/reset.
 *
 * Two fields below don't exist in the client's PDF spec — they're gap-fills
 * for open questions already sent to the client (invited-carrier list and
 * bid-email-sent timestamp, see requirements-tracker.md). Marked GAP-FILL so
 * they're easy to find and reconcile once the client responds.
 */

export const MOCK_ACCOUNT_ID = "mock-account-1";

const now = () => new Date("2026-07-17T09:00:00-04:00"); // fixed reference point for reproducible mock data

let carriers: any[];
let loads: any[];
let quotes: any[];

function seedCarriers() {
  return [
    {
      id: "carrier-1",
      legalName: "Pacific Coast Drayage LLC",
      dba: undefined,
      mcNumber: "MC-123456",
      usdotNumber: "USDOT-7891011",
      contacts: [
        // Real test number (temporary — see requirements-tracker.md test-flow note)
        { name: "Maria Gomez", phone: "+919589817903", email: "dispatch@pacificcoastdrayage.example", role: "dispatch", preferredMethod: "phone" },
      ],
      timezone: "Asia/Kolkata",
      eligibility: {
        approvedAuthority: true,
        approvedInsurance: true,
        approvedEquipment: ["40ft_dry", "20ft_dry", "chassis"],
        approvedGeography: ["CA"],
        safetyStatus: "ok",
        fraudFlag: false,
      },
      serviceHistory: { laneCount: 42, lastServiceDate: "2026-06-01" },
      doNotCall: { calls: false, email: false, recordedAt: null },
    },
    {
      id: "carrier-2",
      legalName: "Norfolk Intermodal Transport Inc.",
      dba: undefined,
      mcNumber: "MC-654321",
      usdotNumber: "USDOT-1122334",
      contacts: [
        // Real test number (temporary — see requirements-tracker.md test-flow note)
        { name: "James Whitfield", phone: "+918349086753", email: "ops@norfolkintermodal.example", role: "dispatch", preferredMethod: "email" },
      ],
      timezone: "Asia/Kolkata",
      eligibility: {
        approvedAuthority: true,
        approvedInsurance: true,
        approvedEquipment: ["40ft_dry", "reefer", "chassis"],
        approvedGeography: ["VA", "NC"],
        safetyStatus: "ok",
        fraudFlag: false,
      },
      serviceHistory: { laneCount: 17, lastServiceDate: "2026-05-15" },
      doNotCall: { calls: false, email: false, recordedAt: null },
    },
    {
      id: "carrier-3",
      legalName: "Gulf Cartage & Warehousing Co.",
      dba: undefined,
      mcNumber: "MC-789012",
      usdotNumber: "USDOT-5566778",
      contacts: [
        // Real test number (temporary — see requirements-tracker.md test-flow note)
        { name: "Priya Natarajan", phone: "+918871148578", email: "quotes@gulfcartage.example", role: "pricing", preferredMethod: "phone" },
      ],
      timezone: "Asia/Kolkata",
      eligibility: {
        approvedAuthority: true,
        approvedInsurance: true,
        approvedEquipment: ["40ft_dry", "20ft_dry", "chassis", "transload"],
        approvedGeography: ["TX"],
        safetyStatus: "ok",
        fraudFlag: false,
      },
      serviceHistory: { laneCount: 63, lastServiceDate: "2026-06-10" },
      doNotCall: { calls: false, email: false, recordedAt: null },
    },
  ];
}

function seedLoads() {
  return [
    {
      id: "load-1001",
      externalId: "MOCK-LOAD-1001",
      accountId: MOCK_ACCOUNT_ID,
      equipment: { containerSize: "40ft", containerType: "dry", chassisRequired: true },
      routing: {
        portOrRailRamp: "Port of Los Angeles",
        pickupTerminal: "APM Terminal",
        deliveryCity: "Ontario",
        deliveryState: "CA",
        deliveryZip: "91761",
        miles: 55,
      },
      timing: {
        earliestPickup: "2026-07-20T08:00:00-07:00",
        lastFreeDay: "2026-07-22",
        deliveryWindowStart: "2026-07-20T12:00:00-07:00",
        deliveryWindowEnd: "2026-07-20T17:00:00-07:00",
        bidExpiration: "2026-07-19T17:00:00-07:00",
        // GAP-FILL: not in the client's PDF spec yet — see requirements-tracker.md
        // question #2 (bid-email-sent timestamp). Everly's cadence.ts needs this
        // to schedule the first call attempt.
        bidEmailSentAt: "2026-07-01T08:15:00-04:00", // safely in the past so the mock is always ready to test
      },
      cargo: { commodity: "General merchandise", grossWeight: 38000 },
      serviceScope: "drayage",
      operationalAssumptions: {
        liveOrDrop: "live",
        freeTime: "2 hours",
        chassisSource: "carrier_supplied",
        containerQuantity: 1,
        frequency: "one_time",
      },
      pricingRules: { lineItemOrAllIn: "line_item", currency: "USD" },
      disclosureSettings: {
        aiDisclosureRequired: true,
        recordingDisclosureRequired: true,
        shareBrokerIdentity: false,
        firmOrForecasted: "firm",
      },
      quoteThreshold: 3,
      bidCloseAt: "2026-07-19T17:00:00-07:00",
      status: "open",
      // GAP-FILL: not in the client's PDF spec yet — see requirements-tracker.md
      // question #1 (invited-carrier list). Without this, there's no reliable
      // way to know who was actually invited to bid vs. who just matches the
      // load's equipment/lane on paper.
      invitedCarrierIds: ["carrier-1", "carrier-2", "carrier-3"],
    },
    {
      id: "load-1002",
      externalId: "MOCK-LOAD-1002",
      accountId: MOCK_ACCOUNT_ID,
      equipment: { containerSize: "40ft", containerType: "dry", chassisRequired: true },
      routing: {
        portOrRailRamp: "Port of Virginia",
        pickupTerminal: "Norfolk International Terminal",
        deliveryCity: "Richmond",
        deliveryState: "VA",
        deliveryZip: "23219",
        miles: 105,
      },
      timing: {
        earliestPickup: "2026-07-21T08:00:00-04:00",
        lastFreeDay: "2026-07-24",
        deliveryWindowStart: "2026-07-21T13:00:00-04:00",
        deliveryWindowEnd: "2026-07-21T18:00:00-04:00",
        bidExpiration: "2026-07-20T17:00:00-04:00",
        bidEmailSentAt: "2026-07-01T08:30:00-04:00", // safely in the past so the mock is always ready to test
      },
      cargo: { commodity: "Retail apparel", grossWeight: 29500 },
      serviceScope: "drayage_transload",
      operationalAssumptions: {
        liveOrDrop: "drop",
        freeTime: "3 hours",
        chassisSource: "customer_supplied",
        containerQuantity: 2,
        frequency: "weekly",
      },
      pricingRules: { lineItemOrAllIn: "all_in", currency: "USD" },
      disclosureSettings: {
        aiDisclosureRequired: true,
        recordingDisclosureRequired: true,
        shareBrokerIdentity: false,
        firmOrForecasted: "firm",
      },
      warehouseStorage: {
        required: true,
        palletCountEstimate: 24,
        startDate: "2026-07-22",
        estimatedDuration: "14 days",
        storageClass: "ambient",
      },
      quoteThreshold: 3,
      bidCloseAt: "2026-07-20T17:00:00-04:00",
      status: "open",
      invitedCarrierIds: ["carrier-2"],
    },
  ];
}

function seedAccountSettings() {
  return {
    [MOCK_ACCOUNT_ID]: {
      accountId: MOCK_ACCOUNT_ID,
      quoteThreshold: 3,
      emailWaitMinutes: 30,
      maxCallAttempts: 4,
      callingWindow: { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], startHour: 8, endHour: 17 },
      voicemailPolicy: { allowed: true },
      disclosurePolicy: { aiDisclosureRequired: true, wording: "TBD-CONFIG, pending MDR legal sign-off" },
      negotiationAuthority: "none",
    },
  };
}

let accountSettings: Record<string, any>;

export function resetMockData() {
  carriers = seedCarriers();
  loads = seedLoads();
  quotes = [];
  accountSettings = seedAccountSettings();
}

resetMockData();

export const db = {
  get carriers() {
    return carriers;
  },
  get loads() {
    return loads;
  },
  get quotes() {
    return quotes;
  },
  get accountSettings() {
    return accountSettings;
  },
  now,
};
