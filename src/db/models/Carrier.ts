import { Schema, model } from "mongoose";

const contactSchema = new Schema(
  {
    name: String,
    phone: String,
    email: String,
    role: String,
    preferredMethod: { type: String, enum: ["phone", "email"] },
  },
  { _id: false }
);

const carrierSchema = new Schema(
  {
    externalId: { type: String, index: true, unique: true, sparse: true }, // MDR's carrier ID, once integrated
    legalName: { type: String, required: true },
    dba: String,
    mcNumber: String,
    usdotNumber: String,
    contacts: [contactSchema],
    timezone: { type: String, required: true }, // IANA tz, e.g. "America/Los_Angeles" — required for calling window checks

    eligibility: {
      approvedAuthority: { type: Boolean, default: false },
      approvedInsurance: { type: Boolean, default: false },
      approvedEquipment: [String],
      approvedGeography: [String],
      safetyStatus: { type: String, enum: ["ok", "flagged", "unknown"], default: "unknown" },
      fraudFlag: { type: Boolean, default: false },
    },

    serviceHistory: {
      laneCount: { type: Number, default: 0 },
      lastServiceDate: Date,
    },

    doNotCall: {
      calls: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      recordedAt: Date,
    },

    preferences: {
      notes: String,
    },
  },
  { timestamps: true }
);

export const Carrier = model("Carrier", carrierSchema);
