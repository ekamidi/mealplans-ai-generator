import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { getPriceIdFromType } from "@/lib/plans";

export async function POST(request: NextRequest) {
    try {
        const clerkUser = await currentUser();
        if(!clerkUser?.id) {
            return NextResponse.json({ error: "Unauthorized" });
        }

        const { newPlan } = await request.json();

        if(!newPlan) {
            return NextResponse.json({ error: "New plan is required." }, { status: 400 });
        }

        // Fetch existing subscription
        const profile = await prisma?.profile.findUnique({
            where: { userId: clerkUser.id },
        });

        if(!profile) {
            return NextResponse.json({ error: "No profile found" });
        }

        if(!profile.stripeSubscriptionId) {
            return NextResponse.json({ error: "No Active Subscription Found." });
        }

        const subscriptionId = profile.stripeSubscriptionId;

        // Retrieve the subscription from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const subscriptionItemId = subscription.items.data[0]?.id;

        if(!subscriptionItemId) {
            return NextResponse.json({ error: "Subscription Item Not Found." });
        }

        // Update subscription in Stripe
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: false,
            items: [
                {
                    id: subscriptionItemId,
                    price: getPriceIdFromType(newPlan),
                }
            ],
            proration_behavior: "create_prorations",
        });

        // Call prisma client to update the user record in the DB
        await prisma.profile.update({
            where: { userId: clerkUser.id },
            data: {
                subscriptionTier: newPlan,
                stripeSubscriptionId: updatedSubscription.id,
                subscriptionActive: true,
            },
        });

        return NextResponse.json({ subscription: updatedSubscription });
    } catch(error: any) {
        console.error("Error changing subscription plan:", error);
        return NextResponse.json(
            { error: error.message || "Failed to change subscription plan." },
            { status: 500 }
        );
    }
}