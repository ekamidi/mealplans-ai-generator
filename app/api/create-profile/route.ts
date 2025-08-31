import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@clerk/nextjs/server";


export async function POST() {
    try {
        const clerkUser = await currentUser();
        if(!clerkUser) {
            return NextResponse.json(
                { error: "User not found in Clerk." },
                { status: 404 }
            );
        }
        const email = clerkUser.emailAddresses[0].emailAddress;
        if(!email) {
            return NextResponse.json(
                { error: "User does not have an email address." },
                { status: 404 }
            );
        }

        const existingProfile = await prisma.profile.findUnique({
            where: {
                userId: clerkUser.id
            }
        });

        if(existingProfile) {
            return NextResponse.json(
                { message: "Profile already exists." },
            );
        }

        await prisma.profile.create({
            data: {
                userId: clerkUser.id,
                email,
                subscriptionActive: false,
                subscriptionTier: null,
                stripeSubscriptionId: null,
            },
        });

        console.log(`Prisma profile created for user: ${clerkUser.id}`);
        return NextResponse.json(
            { message: "Profile created successfully." },
            { status: 201 }
        );
    } catch(error) {
        console.error("Error creating profile:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}