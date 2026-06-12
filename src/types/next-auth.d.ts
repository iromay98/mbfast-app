import type { Role } from "@/generated/prisma/client";
import type { DefaultSession } from "next-auth";

// セッション/JWT に独自フィールド(role, dealerId)を載せるための型拡張
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      dealerId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    dealerId: string | null;
  }
}

// JWT 本体は @auth/core/jwt で宣言され next-auth/jwt から再エクスポートされるため、
// 元モジュールを拡張する必要がある。
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    dealerId: string | null;
  }
}
