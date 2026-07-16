import { Schema, model } from "mongoose";

const loadSchema = new Schema(
  {
    externalId: { type: String, index: true, unique: true, sparse: true }, // MDR load/bid ID

    equipment: {
      containerSize: String,
      containerType: String,
      chassisRequired: Boolean,
      overweight: Boolean,
      hazmat: Boolean,
      reefer: Boolean,
      isoTank: Boolean,
      flatRack: Boolean,
      openTop: Boolean,
      other: String,
    },

    routing: {
      portOrRailRamp: String,
      pickupTerminal: String,
      deliveryCity: String,
      deliveryState: String,
      deliveryZip: String,
      returnLocation: String,
      finalMileDestination: String,
      miles: Number,
    },

    timing: {
      vesselOrRailAvailability: String,
      earliestPickup: Date,
      lastFreeDay: Date,
      deliveryWindowStart: Date,
      deliveryWindowEnd: Date,
      bidExpiration: Date,
      expectedStartDate: Date,
    },

    cargo: {
      commodity: String,
      grossWeight: Number,
      containerWeight: Number,
      hazmatDetails: String,
      temperature: String,
      value: Number,
      specialHandling: String,
    },

    serviceScope: {
      type: String,
      enum: ["drayage", "drayage_transload", "drayage_final_mile", "combined"],
      required: true,
      default: "drayage",
    },

    operationalAssumptions: {
      liveOrDrop: { type: String, enum: ["live", "drop"] },
      freeTime: String,
      chassisSource: String,
      prePull: Boolean,
      yardStorage: Boolean,
      containerQuantity: Number,
      frequency: { type: String, enum: ["one_time", "daily", "weekly"] },
      volumeDuration: String,
    },

    pricingRules: {
      lineItemOrAllIn: { type: String, enum: ["line_item", "all_in"], default: "line_item" },
      currency: { type: String, default: "USD" },
      fuelTreatment: String,
      targetRateShareable: { type: Boolean, default: false }, // TBD-CONFIG default until MDR confirms
      targetRate: Number,
    },

    disclosureSettings: {
      aiDisclosureRequired: { type: Boolean, default: true },
      recordingDisclosureRequired: { type: Boolean, default: true },
      shareBrokerIdentity: { type: Boolean, default: false }, // TBD-CONFIG default until MDR confirms
      firmOrForecasted: { type: String, enum: ["firm", "forecasted"], default: "firm" },
    },

    warehouseStorage: {
      required: { type: Boolean, default: false },
      palletCountEstimate: Number,
      startDate: Date,
      estimatedDuration: String,
      storageClass: {
        type: String,
        enum: ["ambient", "refrigerated", "bonded", "hazmat", "other"],
      },
    },

    // Account-level defaults, confirmed by Frank — can still be overridden per load
    quoteThreshold: { type: Number, default: 3 },
    emailWaitMinutes: { type: Number, default: 30 },
    maxCallAttempts: { type: Number, default: 4 },
    bidCloseAt: Date,

    status: {
      type: String,
      enum: ["open", "threshold_met", "closed", "awarded", "paused", "cancelled"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true }
);

export const Load = model("Load", loadSchema);
