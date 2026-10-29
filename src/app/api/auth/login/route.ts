import { NextRequest, NextResponse } from "next/server";
import {
  verifyPassword,
  signSessionValue,
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      );
    }

    if (!verifyPassword(password)) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    const signedValue = await signSessionValue("authenticated");

    const response = NextResponse.json({ success: true });

    response.cookies.set(COOKIE_NAME, signedValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
