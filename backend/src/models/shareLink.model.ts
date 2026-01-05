import { Schema, model, Document, Types } from 'mongoose';

export interface IShareLink extends Document {
  token: string;
  ownerId: Types.ObjectId;
  ownerName?: string;
  used: boolean;
  usedBy?: Types.ObjectId;
  usedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
}

const shareLinkSchema = new Schema<IShareLink>({
  token: { type: String, required: true, unique: true, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ownerName: { type: String },
  used: { type: Boolean, default: false },
  usedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  usedAt: { type: Date },
  expiresAt: { type: Date },
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

shareLinkSchema.index({ token: 1 });

export const ShareLink = model<IShareLink>('ShareLink', shareLinkSchema);
