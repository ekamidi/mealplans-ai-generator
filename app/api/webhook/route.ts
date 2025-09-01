import { stripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event: Stripe.Event;

    // Verify Stripe event is legit
    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature || "",
            webhookSecret
        );
    } catch(error: any) {

        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    try {
        switch(event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutSessionCompleted(session);
                break;
            }
            case "invoice.payment_failed": {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaymentFailed(invoice);
                break;
            }
            case "customer.subscription.deleted": {
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionDeleted(subscription);
                break;
            }
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
    } catch(error: any) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({});
}

// Handler for successful checkout sessions
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.clerkUserId;

    if(!userId) {
        console.log("No userId found in session metadata.");
        return;
    }

    const subscriptionId = session.subscription as string;

    if(!subscriptionId) {
        console.log("No subscription ID found in session.");
        return;
    }

    try {
        await prisma.profile.update({
            where: { userId },
            data: {
                stripeSubscriptionId: subscriptionId,
                subscriptionActive: true,
                subscriptionTier: session.metadata?.planType || null
            }
        });
    } catch(error: any) {
        console.log("Prisma update error", error.message);
    }
}

// Handler for failed invoice payments
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const subId = invoice.account_name as string;

    if(!subId) {
        return;
    }

    // Retrieve userId from subscription ID
    let userId: string | undefined;
    try {
        const profile = await prisma.profile.findUnique({
            where: {
                stripeSubscriptionId: subId
            },
            select: {
                userId: true
            }
        });

        if(!profile?.userId) {
            console.log("No profile found");
            return;
        }
        userId = profile.userId;
    } catch(error: any) {
        console.log(error.message);
        return;
    }

    // Call Prisma to update the user record in the DB with payment failure
    try {
        await prisma.profile.update({
            where: { userId: userId },
            data: {
                subscriptionActive: false,
            }
        });
    } catch(error: any) {
        console.log(error.message);
    }
}

// Handler for subscription deletions (e.g., cancellations)
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const subId = subscription.id;

    let userId: string | undefined;
    try {
        const profile = await prisma.profile.findUnique({
            where: {
                stripeSubscriptionId: subId
            },
            select: {
                userId: true
            }
        });

        if(!profile?.userId) {
            console.log("No profile found");
            return;
        }
        userId = profile.userId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch(error: any) {
        console.log(error.message);
        return;
    }

    // Update Prisma with subscription cancellation
    try {
        await prisma.profile.update({
            where: { userId: userId },
            data: {
                subscriptionActive: false,
                stripeSubscriptionId: null,
                subscriptionTier: null,
            }
        });
    } catch(error: any) {
        console.log(error.message);
    }
}