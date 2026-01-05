import { Schema, model, Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  userAgent?: string;
  ipAddress: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  method: {
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
  path: {
    type: String,
    required: true,
  },
  status: {
    type: Number,
    required: true,
    min: 100,
    max: 599,
  },
  latencyMs: {
    type: Number,
    required: true,
    min: 0,
  },
  userAgent: String,
  ipAddress: {
    type: String,
    required: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

// Indexes
auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ status: 1 });
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
