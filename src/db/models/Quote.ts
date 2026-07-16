import { Schema, model, Types } from "mongoose";

const accessorialSchema = new Schema(
  {
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    unit: String,
    trigger: String,
  },
  { _id: false }
);

const quoteSchema = new Schema(
  {
    loadId: { type: Types.ObjectId, ref: "Load", required: true, index: true },
    carrierId: { type: Types.ObjectId, ref: "Carrier", required: true, index: true },
    callAttemptId: { type: Types.ObjectId, ref: "CallAttempt" }, // null if ever sourced from email
    source: { type: String, enum: ["call", "email"], required: true, default: "call" },

    serviceScope: {
      type: String,
      enum: ["drayage", "drayage_transload", "drayage_final_mile", "combined"],
      required: true,
    },

    baseRate: { type: Number, required: true },
    fuelSurcharge: {
      amount: Number,
      includedInBase: Boolean,
    },
    chassis: {
      amount: Number,
      includedInBase: Boolean,
      source: { type: String, enum: ["carrier_supplied", "customer_supplied"] },
    },
    accessorials: [accessorialSchema],
    freeTime: String,
    detentionRate: Number,

    totalEstimatedAllIn: { type: Number, required: true },
    capacity: String,
    rateValidUntil: { type: Date, required: true },

    transload: {
      facilityName: String,
      facilityAddress: String,
      carrierOperated: Boolean,
      unloadCharge: Number,
      accessorials: [accessorialSchema],
    },

    warehouseStorage: {
      ratePerPalletPerDay: Number,
      ratePerPalletPerMonth: Number,
      freeDays: Number,
      freeDaysBasis: { type: String, enum: ["calendar", "business"] },
      billingStartTrigger: String,
      minimumCharge: String,
    },

    finalMile: {
      baseRate: Number,
      equipmentType: String,
      accessorials: [accessorialSchema],
    },

    isConditional: { type: Boolean, default: false },
    conditionalOn: String,
    carrierConfirmedReadBack: { type: Boolean, required: true },

    // Quote validation + duplicate control (playbook Section 12)
    status: {
      type: String,
      enum: ["pending_review", "valid", "invalid", "superseded"],
      default: "pending_review",
      index: true,
    },
    version: { type: Number, default: 1 }, // a revised quote increments this; must not double-count toward threshold
  },
  { timestamps: true }
);

// Supports duplicate control: match by load + carrier + scope, latest version wins.
quoteSchema.index({ loadId: 1, carrierId: 1, serviceScope: 1 });

export const Quote = model("Quote", quoteSchema);
