import { z } from "zod";
import { tokenTradeInputSchema, tokenTradeQuoteSchema } from "./token-launch.js";
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((v) => !/^0x0+$/.test(v));
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
export const publicTokenTradeInputSchema = tokenTradeInputSchema
  .extend({ wallet: address, side: z.enum(["buy", "sell"]) })
  .strict();
export const publicTokenTradePreparedSchema = z
  .object({
    version: z.literal(1),
    token: address,
    curve: address,
    quoteToken: address,
    expiresAt: z.string().datetime(),
    quote: tokenTradeQuoteSchema,
    transaction: z
      .object({
        from: address,
        to: address,
        data: hex,
        value: z.literal("0x0"),
        chainId: z.literal(10143),
        nonce: z.number().int().min(0),
        gas: hex,
        maxFeePerGas: hex,
        maxPriorityFeePerGas: hex,
      })
      .strict(),
  })
  .strict();
export type PublicTokenTradeInputDto = z.infer<typeof publicTokenTradeInputSchema>;
export type PublicTokenTradePreparedDto = z.infer<typeof publicTokenTradePreparedSchema>;
