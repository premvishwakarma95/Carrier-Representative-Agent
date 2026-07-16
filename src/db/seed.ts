/**
 * Seeds mock loads and carriers for local development/testing (Step 3.3 / Step 5).
 * Wipes and recreates the collections each run — dev-only, never point this at real data.
 *
 * Usage: npm run db:seed
 */
import { connectDB, disconnectDB } from "./connection.js";
import { Carrier, Load } from "./models/index.js";

async function main() {
  await connectDB();

  await Promise.all([Carrier.deleteMany({}), Load.deleteMany({})]);

  const carriers = await Carrier.insertMany([
    {
      legalName: "Pacific Coast Drayage LLC",
      mcNumber: "MC-123456",
      usdotNumber: "USDOT-7891011",
      contacts: [
        { name: "Maria Gomez", phone: "+13105550101", email: "dispatch@pacificcoastdrayage.example", role: "dispatch", preferredMethod: "phone" },
      ],
      timezone: "America/Los_Angeles",
      eligibility: {
        approvedAuthority: true,
        approvedInsurance: true,
        approvedEquipment: ["40ft_dry", "20ft_dry", "chassis"],
        approvedGeography: ["CA"],
        safetyStatus: "ok",
        fraudFlag: false,
      },
      serviceHistory: { laneCount: 42, lastServiceDate: new Date("2026-06-01") },
    },
    {
      legalName: "Norfolk Intermodal Transport Inc.",
      mcNumber: "MC-654321",
      usdotNumber: "USDOT-1122334",
      contacts: [
        { name: "James Whitfield", phone: "+17575550199", email: "ops@norfolkintermodal.example", role: "dispatch", preferredMethod: "email" },
      ],
      timezone: "America/New_York",
      eligibility: {
        approvedAuthority: true,
        approvedInsurance: true,
        approvedEquipment: ["40ft_dry", "reefer", "chassis"],
        approvedGeography: ["VA", "NC"],
        safetyStatus: "ok",
        fraudFlag: false,
      },
      serviceHistory: { laneCount: 17, lastServiceDate: new Date("2026-05-15") },
    },
    {
      legalName: "Gulf Cartage & Warehousing Co.",
      mcNumber: "MC-789012",
      usdotNumber: "USDOT-5566778",
      contacts: [
        { name: "Priya Natarajan", phone: "+17135550188", email: "quotes@gulfcartage.example", role: "pricing", preferredMethod: "phone" },
      ],
      timezone: "America/Chicago",
      eligibility: {
        approvedAuthority: true,
        approvedInsurance: true,
        approvedEquipment: ["40ft_dry", "20ft_dry", "chassis", "transload"],
        approvedGeography: ["TX"],
        safetyStatus: "ok",
        fraudFlag: false,
      },
      serviceHistory: { laneCount: 63, lastServiceDate: new Date("2026-06-10") },
      doNotCall: { calls: false, email: false },
    },
  ]);

  const loads = await Load.insertMany([
    {
      externalId: "MOCK-LOAD-1001",
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
        earliestPickup: new Date("2026-07-20T08:00:00-07:00"),
        lastFreeDay: new Date("2026-07-22"),
        deliveryWindowStart: new Date("2026-07-20T12:00:00-07:00"),
        deliveryWindowEnd: new Date("2026-07-20T17:00:00-07:00"),
        bidExpiration: new Date("2026-07-19T17:00:00-07:00"),
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
      quoteThreshold: 3,
      emailWaitMinutes: 30,
      maxCallAttempts: 4,
      bidCloseAt: new Date("2026-07-19T17:00:00-07:00"),
      status: "open",
    },
    {
      externalId: "MOCK-LOAD-1002",
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
        earliestPickup: new Date("2026-07-21T08:00:00-04:00"),
        lastFreeDay: new Date("2026-07-24"),
        deliveryWindowStart: new Date("2026-07-21T13:00:00-04:00"),
        deliveryWindowEnd: new Date("2026-07-21T18:00:00-04:00"),
        bidExpiration: new Date("2026-07-20T17:00:00-04:00"),
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
      warehouseStorage: {
        required: true,
        palletCountEstimate: 24,
        startDate: new Date("2026-07-22"),
        estimatedDuration: "14 days",
        storageClass: "ambient",
      },
      quoteThreshold: 3,
      emailWaitMinutes: 30,
      maxCallAttempts: 4,
      bidCloseAt: new Date("2026-07-20T17:00:00-04:00"),
      status: "open",
    },
  ]);

  console.log(`Seeded ${carriers.length} carriers and ${loads.length} loads.`);
  console.log("Carrier IDs:", carriers.map((c) => c.id));
  console.log("Load IDs:", loads.map((l) => l.id));

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
