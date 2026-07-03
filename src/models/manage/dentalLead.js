// import mongoose from "mongoose";

// /* ── Follow-up log entry — max 3 touches PER ROUND, then auto-rolls to next round ── */
// const followUpSchema = new mongoose.Schema(
//   {
//     agent:      { type: String, required: true, trim: true },
//     employeeId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       required: true,
//     },
//     /* Did the customer pick up the call? */
//     callStatus: {
//       type: String,
//       required: true,
//     },
//     /* Optional extra detail — why not picked, what was discussed, etc. */
//     reason:       { type: String, trim: true, default: "" },
//     nextCallDate: { type: Date, required: true },
//     round:        { type: Number, required: true, default: 1 }, // month cycle
//     touchNumber:  { type: Number, required: true, min: 1, max: 3 }, // 1-3 within round
//     loggedAt:     { type: Date, default: Date.now },
//   },
//   { _id: true }
// );

// /* ── WhatsApp contact sub-schema ── */
// const whatsappSchema = new mongoose.Schema(
//   {
//     sent:    { type: Boolean, default: false },
//     replied: { type: Boolean, default: false },
//     noReply: {
//       reason:  { type: String, trim: true, default: "" },
//       fixDate: { type: Date, default: null },
//     },
//   },
//   { _id: false }
// );

// /* ── Main DentalLead schema ── */
// const dentalLeadSchema = new mongoose.Schema(
//   {
//     doctorName: { type: String, trim: true },
//     clinicName: { type: String, trim: true, default: "" },
//     email:      { type: String, lowercase: true, trim: true, default: "" },
//     contact:    { type: String, trim: true },
//     city:       { type: String, trim: true, default: "" },
//     state:      { type: String, trim: true, default: "" },
//     address:    { type: String, trim: true, default: "" },
//     enquiry:    { type: String, trim: true, default: "" },
//     remarks:    { type: String, trim: true, default: "" },

//     stage: {
//       type: String,
//       enum: ["inquiry", "followup", "client", "flag"],
//       default: "inquiry",
//       index: true,
//     },

//     clientId: { type: String, trim: true, default: null, sparse: true },

//     /* No length cap here anymore — rounds keep rolling monthly until converted */
//     preSaleFollowups:  { type: [followUpSchema], default: [] },
//     postSaleFollowups: { type: [followUpSchema], default: [] },

//     whatsapp:   { type: whatsappSchema, default: () => ({}) },
//     callCount:  { type: Number, default: 0, min: 0 },
//     moveReason: { type: String, trim: true, default: "" },

//     flagReason: { type: String, trim: true, default: "" },
//     flaggedAt:  { type: Date, default: null },
//     flaggedBy:  { type: String, trim: true, default: "" },

//     contactBy: { type: String, trim: true, default: "" },

//     source: {
//       type: String,
//       enum: ["manual", "excel"],
//       default: "manual",
//     },
//     invoiceId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Invoice",
//     },

//     nextFollowUpDate: { type: Date, default: null, index: 1 },

//     isDeleted: { type: Boolean, default: false },
//   },
//   { timestamps: true }
// );

// dentalLeadSchema.pre("save", function () {
//   const allDates = [...this.preSaleFollowups, ...this.postSaleFollowups]
//     .map((f) => f?.nextCallDate)
//     .filter(Boolean);

//   if (allDates.length > 0) {
//     allDates.sort((a, b) => new Date(a) - new Date(b));
//     this.nextFollowUpDate = allDates[0];
//   } else {
//     this.nextFollowUpDate = null;
//   }
// });

// export default mongoose.model("DentalLead", dentalLeadSchema);


import mongoose from "mongoose";

/* ────────────────────────────────────────────────────────────────
   Remark Follow-up
   Used in Inquiry/Follow-up stage (Round + Touch tracking)
──────────────────────────────────────────────────────────────── */
const remarkFollowupSchema = new mongoose.Schema(
  {
    agent: {
      type: String,
      required: true,
      trim: true,
    },

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    callStatus: {
      type: String,
      required: true,
    },

    reason: {
      type: String,
      trim: true,
      default: "",
    },

    nextCallDate: {
      type: Date,
      required: true,
    },

    round: {
      type: Number,
      required: true,
      default: 1,
    },

    touchNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },

    loggedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

/* ────────────────────────────────────────────────────────────────
   Pre/Post Sale Follow-up
   Used in Stage 2 & Stage 3 Followup Modal
──────────────────────────────────────────────────────────────── */
const stageFollowupSchema = new mongoose.Schema(
  {
    agent: {
      type: String,
      required: true,
      trim: true,
    },

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    notes: {
      type: String,
      trim: true,
    },

    hurdle: {
      type: String,
      trim: true,
      default: "",
    },

    nextCallDate: {
      type: Date,
      required: true,
    },

    loggedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

/* ────────────────────────────────────────────────────────────────
   WhatsApp Status
──────────────────────────────────────────────────────────────── */
const whatsappSchema = new mongoose.Schema(
  {
    sent: {
      type: Boolean,
      default: false,
    },

    replied: {
      type: Boolean,
      default: false,
    },

    noReply: {
      reason: {
        type: String,
        trim: true,
        default: "",
      },

      fixDate: {
        type: Date,
        default: null,
      },
    },
  },
  { _id: false }
);

/* ────────────────────────────────────────────────────────────────
   Dental Lead
──────────────────────────────────────────────────────────────── */
const dentalLeadSchema = new mongoose.Schema(
  {
    doctorName: {
      type: String,
      trim: true,
    },

    clinicName: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },

    contact: {
      type: String,
      trim: true,
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    enquiry: {
      type: String,
      trim: true,
      default: "",
    },

    remarks: {
      type: String,
      trim: true,
      default: "",
    },

    stage: {
      type: String,
      enum: ["inquiry", "followup", "client", "flag"],
      default: "inquiry",
      index: true,
    },

    clientId: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
    },

    /* Inquiry / Follow-up stage */
    remarkFollowups: {
      type: [remarkFollowupSchema],
      default: [],
    },

    /* Client Stage */
    preSaleFollowups: {
      type: [stageFollowupSchema],
      default: [],
    },

    /* Client Stage */
    postSaleFollowups: {
      type: [stageFollowupSchema],
      default: [],
    },

    whatsapp: {
      type: whatsappSchema,
      default: () => ({}),
    },

    callCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    moveReason: {
      type: String,
      trim: true,
      default: "",
    },

    flagReason: {
      type: String,
      trim: true,
      default: "",
    },

    flaggedAt: {
      type: Date,
      default: null,
    },

    flaggedBy: {
      type: String,
      trim: true,
      default: "",
    },

    contactBy: {
      type: String,
      trim: true,
      default: "",
    },

    source: {
      type: String,
      enum: ["manual", "excel"],
      default: "manual",
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },

    nextFollowUpDate: {
      type: Date,
      default: null,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

/* ────────────────────────────────────────────────────────────────
   Automatically store the nearest upcoming follow-up date
──────────────────────────────────────────────────────────────── */
dentalLeadSchema.pre("save", function () {
  const dates = [
    ...this.remarkFollowups,
    ...this.preSaleFollowups,
    ...this.postSaleFollowups,
  ]
    .map((f) => f?.nextCallDate)
    .filter(Boolean)
    .map((d) => new Date(d));

  if (dates.length) {
    dates.sort((a, b) => a - b);
    this.nextFollowUpDate = dates[0];
  } else {
    this.nextFollowUpDate = null;
  }
});

export default mongoose.model("DentalLead", dentalLeadSchema);