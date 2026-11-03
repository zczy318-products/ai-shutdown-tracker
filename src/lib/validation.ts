import { z } from "zod";

/** Emails are stored normalized so uniqueness is case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "请输入邮箱")
    .max(254, "邮箱过长")
    .pipe(z.email("邮箱格式不正确"))
    .transform(normalizeEmail),
  // Length only: an upper bound matters because scrypt hashes whatever it is given.
  password: z.string().min(8, "密码至少 8 位").max(200, "密码过长"),
});

export type Credentials = z.infer<typeof credentialsSchema>;
