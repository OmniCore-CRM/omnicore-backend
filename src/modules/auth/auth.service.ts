import bcrypt from "bcrypt";
import { prisma } from "@/config/db.js";
import type { RegisterInput, LoginInput } from "./auth.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { generateAccessToken } from "./auth.utils.js";
import { mapAuthResponse } from "./auth.mapper.js";

export class AuthService {
  // ===== Register new company owner =====
  static async register(data: RegisterInput) {
    const {
      companyName,
      firstName,
      lastName,
      email,
      password,
    } = data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      throw new AppError(
        "User with this email already exists",
        HTTP_STATUS.CONFLICT
      );
    }

    // Hash password before saving to database
    const passwordHash = await bcrypt.hash(password, 10);

    // Create company + owner account atomically
    const { company, user } = await prisma.$transaction(
      async (tx) => {
        // Create tenant company first
        const company = await tx.company.create({
          data: {
            name: companyName,
          },
        });
        
        // Create owner account linked to company
        const user = await tx.user.create({
          data: {
            firstName,
            lastName,
            email,
            passwordHash,
            role: "OWNER",
            companyId: company.id,
          },
        });

        return { company, user };
      }
    );

    // Generate authenticated access token
    const accessToken = generateAccessToken(
      user.id,
      user.companyId,
      user.role
    );

    // Return normalized authenticated onboarding payload
    return mapAuthResponse({
      accessToken,
      user,
      company
    });
  }
  
  // ===== Login Logic (Authenticate existing user) =====
  static async login(data: LoginInput) {
    const { email, password } = data;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: {
        email,
      },

      include: {
        company: true,
      },
    });

    // Prevent leaking whether email exists
    if (!user) {
      throw new AppError(
        "Invalid email or password",
        HTTP_STATUS.UNAUTHORIZED
      );
    }

    // Compare incoming password with stored hash
    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!isPasswordCorrect) {
      throw new AppError(
        "Invalid email or password",
        HTTP_STATUS.UNAUTHORIZED
      );
    }

    // Generate authenticated access token
    const accessToken = generateAccessToken(
      user.id,
      user.companyId,
      user.role
    );

    // Return normalized authenticated session payload
    return mapAuthResponse({
      accessToken,
      user,
      company: user.company,
    });
  }

  // ===== Return authenticated session user =====
  static async getCurrentUser(
    userId: string,
    companyId: string
  ) {
    // Find authenticated tenant user
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        companyId,
      },

      include: {
        company: true,
      },
    });

    // Prevent invalid tenant access
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Return normalized authenticated session payload
    return mapAuthResponse({
      accessToken: "",
      user,
      company: user.company,
    });
  }
}