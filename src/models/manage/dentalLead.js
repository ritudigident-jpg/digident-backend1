// import mongoose from "mongoose";

// /* ────────────────────────────────────────────────────────────────
//    Remark Follow-up
//    Used in Inquiry/Follow-up stage (Round + Touch tracking)
// ──────────────────────────────────────────────────────────────── */
// const remarkFollowupSchema = new mongoose.Schema(
//   {
//     agent: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     employeeId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       required: true,
//     },

//     callStatus: {
//       type: String,
//       required: true,
//     },

//     reason: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     nextCallDate: {
//       type: Date,
//       required: false,
//     },

//     round: {
//       type: Number,
//       required: true,
//       default: 1,
//     },

//     touchNumber: {
//       type: Number,
//       required: true,
//       min: 1,
//       max: 100,
//     },

//     loggedAt: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   { _id: true }
// );

// /* ────────────────────────────────────────────────────────────────
//    Pre/Post Sale Follow-up
//    Used in Stage 2 & Stage 3 Followup Modal
// ──────────────────────────────────────────────────────────────── */
// const stageFollowupSchema = new mongoose.Schema(
//   {
//     agent: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     employeeId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       required: true,
//     },

//     notes: {
//       type: String,
//       trim: true,
//     },

//     hurdle: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     nextCallDate: {
//       type: Date,
//       required: true,
//     },

//     loggedAt: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   { _id: true }
// );

// /* ────────────────────────────────────────────────────────────────
//    WhatsApp Status
// ──────────────────────────────────────────────────────────────── */
// const whatsappSchema = new mongoose.Schema(
//   {
//     sent: {
//       type: Boolean,
//       default: false,
//     },

//     // replied: {
//     //   type: Boolean,
//     //   default: false,
//     // },

//      sentAt: {
//       type: Date,
//       default: null,
//     },

//     noReply: {
//       reason: {
//         type: String,
//         trim: true,
//         default: "",
//       },

//       fixDate: {
//         type: Date,
//         default: null,
//       },
//     },
//   },
//   { _id: false }
// );

// /* ────────────────────────────────────────────────────────────────
//    Assignment History
//    Records every transfer: From Agent → To Agent → By → Date → Reason
// ──────────────────────────────────────────────────────────────── */
// const assignmentHistorySchema = new mongoose.Schema(
//   {
//     fromEmployee: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       default: null,
//     },

//     fromAgent: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     toEmployee: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       required: true,
//     },

//     toAgent: {
//       type: String,
//       trim: true,
//       required: true,
//     },

//     transferredBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       required: true,
//     },

//     transferredByName: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     reason: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     transferredAt: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   { _id: true }
// );

// /* ────────────────────────────────────────────────────────────────
//    Client Invoices
//    One entry per invoice raised for this client, with the employee
//    (agent) who created it. Amount is the total at creation time;
//    live status/payment always comes from the Invoice itself.
// ──────────────────────────────────────────────────────────────── */
// const clientInvoiceSchema = new mongoose.Schema(
//   {
//     invoice: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Invoice",
//       required: true,
//     },

//     // Invoice UUID — the id the /invoice/manage/... routes use
//     invoiceId: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     invoiceNumber: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     totalAmount: {
//       type: Number,
//       default: 0,
//     },

//     createdBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       default: null,
//     },

//     createdByName: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     createdByEmail: {
//       type: String,
//       trim: true,
//       lowercase: true,
//       default: "",
//     },

//     createdAt: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   { _id: false }
// );

// /* ────────────────────────────────────────────────────────────────
//    Dental Lead
// ──────────────────────────────────────────────────────────────── */
// const dentalLeadSchema = new mongoose.Schema(
//   {
//     doctorName: {
//       type: String,
//       trim: true,
//     },

//     clinicName: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     email: {
//       type: String,
//       lowercase: true,
//       trim: true,
//       default: "",
//     },

//     contact: {
//       type: String,
//       trim: true,
//     },

//     city: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     state: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     address: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     enquiry: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     remarks: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     stage: {
//       type: String,
//       enum: ["inquiry", "followup", "client", "flag"],
//       default: "inquiry",
//       index: true,
//     },

//     clientId: {
//       type: String,
//       trim: true,
//       default: null,
//       sparse: true,
//     },

//     // How this record became a client:
//     //   "converted" → Inquiry ➔ Follow-up ➔ Client (convertToClient)
//     //   "direct"    → created manually as a client (createClient)
//     // Left unset for leads that are not clients yet.
//     clientOrigin: {
//       type: String,
//       enum: ["converted", "direct"],
//     },

//     // When a lead was converted into a client (convertToClient only).
//     convertedAt: {
//       type: Date,
//       default: null,
//     },

//     /* ──────────────────────────────────────────────
//        Lead Assignment (Ownership + Redistribution)
//     ────────────────────────────────────────────── */
//     assignedEmployee: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Employee",
//       default: null,
//       index: true,
//     },

//     assignedAgent: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     assignedAt: {
//       type: Date,
//       default: Date.now,
//     },

//     assignmentType: {
//       type: String,
//       enum: ["auto", "manual", "transfer"],
//       default: "auto",
//     },

//     // true as soon as first call/remark/follow-up is logged
//     // untouched leads (false) are the only ones eligible for
//     // automatic redistribution when agents are added/removed
//     isTouched: {
//       type: Boolean,
//       default: false,
//       index: true,
//     },

//     assignmentHistory: {
//       type: [assignmentHistorySchema],
//       default: [],
//     },

//     /* Inquiry / Follow-up stage */
//     remarkFollowups: {
//       type: [remarkFollowupSchema],
//       default: [],
//     },

//     /* Client Stage */
//     preSaleFollowups: {
//       type: [stageFollowupSchema],
//       default: [],
//     },

//     /* Client Stage */
//     postSaleFollowups: {
//       type: [stageFollowupSchema],
//       default: [],
//     },

//     whatsapp: {
//       type: whatsappSchema,
//       default: () => ({}),
//     },

//     callCount: {
//       type: Number,
//       default: 0,
//       min: 0,
//     },

//     moveReason: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     flagReason: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     flaggedAt: {
//       type: Date,
//       default: null,
//     },

//     flaggedBy: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     contactBy: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     source: {
//       type: String,
//       enum: ["manual", "excel"],
//       default: "manual",
//     },

//     // Latest invoice for this client (kept for existing code)
//     invoiceId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Invoice",
//     },

//     // Every invoice for this client + who created it
//     invoices: {
//       type: [clientInvoiceSchema],
//       default: [],
//     },

//     nextFollowUpDate: {
//       type: Date,
//       default: null,
//       index: true,
//     },

//     isDeleted: {
//       type: Boolean,
//       default: false,
//     },
//   },
//   { timestamps: true }
// );

// /* ────────────────────────────────────────────────────────────────
//    clientId must be unique across all client records.
//    Partial index: only documents that actually have a string clientId
//    are indexed, so the many leads with clientId = null don't collide.
// ──────────────────────────────────────────────────────────────── */
// dentalLeadSchema.index(
//   { clientId: 1 },
//   { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
// );

// /* ────────────────────────────────────────────────────────────────
//    Automatically store the nearest upcoming follow-up date
// ──────────────────────────────────────────────────────────────── */
// dentalLeadSchema.pre("save", function () {
//   const sortByNextCallDate = (arr = []) => {
//     arr.sort((a, b) => {
//       const dateA = a?.nextCallDate ? new Date(a.nextCallDate).getTime() : Number.MAX_SAFE_INTEGER;
//       const dateB = b?.nextCallDate ? new Date(b.nextCallDate).getTime() : Number.MAX_SAFE_INTEGER;
//       return dateA - dateB;
//     });
//   };

//   sortByNextCallDate(this.remarkFollowups);
//   sortByNextCallDate(this.preSaleFollowups);
//   sortByNextCallDate(this.postSaleFollowups);

//   const dates = [
//     ...this.remarkFollowups,
//     ...this.preSaleFollowups,
//     ...this.postSaleFollowups,
//   ]
//     .map(f => f?.nextCallDate)
//     .filter(Boolean)
//     .map(d => new Date(d).getTime())
//     .filter(time => !isNaN(time));

//   this.nextFollowUpDate =
//     dates.length > 0 ? new Date(Math.min(...dates)) : null;
// });

// export default mongoose.model("DentalLead", dentalLeadSchema);

import mongoose from "mongoose";
import { buildClientSearchIndex } from "../../helpers/fuzzySearch.helper.js";

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
      required: false,
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
      max: 100,
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

    // replied: {
    //   type: Boolean,
    //   default: false,
    // },

     sentAt: {
      type: Date,
      default: null,
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
   Assignment History
   Records every transfer: From Agent → To Agent → By → Date → Reason
──────────────────────────────────────────────────────────────── */
const assignmentHistorySchema = new mongoose.Schema(
  {
    fromEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },

    fromAgent: {
      type: String,
      trim: true,
      default: "",
    },

    toEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    toAgent: {
      type: String,
      trim: true,
      required: true,
    },

    transferredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    transferredByName: {
      type: String,
      trim: true,
      default: "",
    },

    reason: {
      type: String,
      trim: true,
      default: "",
    },

    transferredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

/* ────────────────────────────────────────────────────────────────
   Client Invoices
   One entry per invoice raised for this client, with the employee
   (agent) who created it. Amount is the total at creation time;
   live status/payment always comes from the Invoice itself.
──────────────────────────────────────────────────────────────── */
const clientInvoiceSchema = new mongoose.Schema(
  {
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },

    // Invoice UUID — the id the /invoice/manage/... routes use
    invoiceId: {
      type: String,
      trim: true,
      default: "",
    },

    invoiceNumber: {
      type: String,
      trim: true,
      default: "",
    },

    totalAmount: {
      type: Number,
      default: 0,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },

    createdByName: {
      type: String,
      trim: true,
      default: "",
    },

    createdByEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    createdAt: {
      type: Date,
      default: Date.now,
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

    // How this record became a client:
    //   "converted" → Inquiry ➔ Follow-up ➔ Client (convertToClient)
    //   "direct"    → created manually as a client (createClient)
    // Left unset for leads that are not clients yet.
    clientOrigin: {
      type: String,
      enum: ["converted", "direct"],
    },

    // When a lead was converted into a client (convertToClient only).
    convertedAt: {
      type: Date,
      default: null,
    },

    /* ──────────────────────────────────────────────
       Lead Assignment (Ownership + Redistribution)
    ────────────────────────────────────────────── */
    assignedEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
      index: true,
    },

    assignedAgent: {
      type: String,
      trim: true,
      default: "",
    },

    assignedAt: {
      type: Date,
      default: Date.now,
    },

    assignmentType: {
      type: String,
      enum: ["auto", "manual", "transfer"],
      default: "auto",
    },

    // true as soon as first call/remark/follow-up is logged
    // untouched leads (false) are the only ones eligible for
    // automatic redistribution when agents are added/removed
    isTouched: {
      type: Boolean,
      default: false,
      index: true,
    },

    assignmentHistory: {
      type: [assignmentHistorySchema],
      default: [],
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

    // Latest invoice for this client (kept for existing code)
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },

    // Every invoice for this client + who created it
    invoices: {
      type: [clientInvoiceSchema],
      default: [],
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

    // Fuzzy search (client picker + client list) — pre-save hook banata hai
    searchIndex: {
      type: {
        _id: false,
        text: { type: String, default: "" },
        keys: { type: [String], default: [] },
        grams: { type: [String], default: [] },
        digits: { type: String, default: "" },
      },
      default: () => ({}),
      select: false,
    },
  },
  { timestamps: true }
);

dentalLeadSchema.index({ isDeleted: 1, stage: 1, assignedEmployee: 1 });
dentalLeadSchema.index({ "searchIndex.keys": 1 });
dentalLeadSchema.index({ "searchIndex.grams": 1 });

/* ────────────────────────────────────────────────────────────────
   clientId must be unique across all client records.
   Partial index: only documents that actually have a string clientId
   are indexed, so the many leads with clientId = null don't collide.
──────────────────────────────────────────────────────────────── */
dentalLeadSchema.index(
  { clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
);

/* ────────────────────────────────────────────────────────────────
   Automatically store the nearest upcoming follow-up date
──────────────────────────────────────────────────────────────── */
dentalLeadSchema.pre("save", function () {
  const sortByNextCallDate = (arr = []) => {
    arr.sort((a, b) => {
      const dateA = a?.nextCallDate ? new Date(a.nextCallDate).getTime() : Number.MAX_SAFE_INTEGER;
      const dateB = b?.nextCallDate ? new Date(b.nextCallDate).getTime() : Number.MAX_SAFE_INTEGER;
      return dateA - dateB;
    });
  };

  sortByNextCallDate(this.remarkFollowups);
  sortByNextCallDate(this.preSaleFollowups);
  sortByNextCallDate(this.postSaleFollowups);

  const dates = [
    ...this.remarkFollowups,
    ...this.preSaleFollowups,
    ...this.postSaleFollowups,
  ]
    .map(f => f?.nextCallDate)
    .filter(Boolean)
    .map(d => new Date(d).getTime())
    .filter(time => !isNaN(time));

  this.nextFollowUpDate =
    dates.length > 0 ? new Date(Math.min(...dates)) : null;

  this.searchIndex = buildClientSearchIndex(this);
});

export default mongoose.model("DentalLead", dentalLeadSchema);