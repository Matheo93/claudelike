# 🚀 DocGenius - Deployment Guide

## 📋 Prerequisites

Before deploying, you'll need:

1. **Supabase Account** (Free tier available)
   - Sign up at: https://supabase.com
   - Create a new project

2. **Vercel Account** (Free tier available)
   - Sign up at: https://vercel.com

3. **API Keys**
   - Anthropic Claude API key
   - OpenAI API key (for visual enhancement)

---

## 1️⃣ Supabase Setup

### Step 1: Create Database Tables

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the entire content from `supabase-schema.sql`
4. Paste and run it in the SQL Editor

This will create:
- ✅ profiles table (user accounts)
- ✅ presentations table (saved presentations)
- ✅ chat_messages table (conversation history)
- ✅ subscriptions table (Stripe payments)
- ✅ usage_logs table (credit tracking)
- ✅ Row Level Security policies
- ✅ Automatic triggers and functions

### Step 2: Get Your Supabase Credentials

1. Go to **Project Settings** > **API**
2. Copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key

---

## 2️⃣ Vercel Deployment

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Deploy

```bash
# Login to Vercel
vercel login

# Deploy the project
vercel

# Follow the prompts:
# - Link to existing project? No
# - Project name: slideforge-ai
# - Directory: ./
# - Override settings? No
```

### Step 3: Set Environment Variables

In Vercel Dashboard (vercel.com):

1. Go to **Project Settings** > **Environment Variables**
2. Add ALL these variables:

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# OpenAI
OPENAI_API_KEY=sk-xxxxx

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

3. Click **Save**

### Step 4: Redeploy

```bash
vercel --prod
```

---

## 4️⃣ Update Stripe Webhook URL

1. Go back to Stripe Dashboard > **Webhooks**
2. Edit your webhook endpoint
3. Update URL to your production URL: `https://your-app.vercel.app/api/stripe-webhook`
4. Save

---

## 5️⃣ Test Your Deployment

### Test Authentication

1. Go to `https://your-app.vercel.app/auth`
2. Create an account
3. Check Supabase **Authentication** > **Users** to verify

### Test Payments (Test Mode)

1. Go to `https://your-app.vercel.app/pricing`
2. Click "Start Pro Trial"
3. Use Stripe test card:
   - Card: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits
4. Check Stripe Dashboard > **Payments** to verify

### Test PDF Processing

1. Go to `https://your-app.vercel.app/app`
2. Upload a PDF
3. Generate a report
4. Test AI chat editing

---

## 6️⃣ Go Live (Production)

### Switch Stripe to Live Mode

1. Complete Stripe account verification
2. Get **live** API keys from https://dashboard.stripe.com/apikeys
3. Update Vercel environment variables with live keys
4. Create live webhook endpoint
5. Redeploy

### Enable Stripe Billing Portal

1. Go to **Settings** > **Billing** > **Customer portal**
2. Enable and configure:
   - Cancel subscription
   - Update payment method
   - View invoices

---

## 🔒 Security Checklist

- ✅ All API keys stored in environment variables (never in code)
- ✅ Supabase Row Level Security enabled
- ✅ Stripe webhook signature verification
- ✅ CORS configured properly
- ✅ No sensitive data in git repository

---

## 📊 Monitoring

### Vercel Logs

```bash
vercel logs
```

### Supabase Logs

1. Go to **Logs** in Supabase Dashboard
2. Monitor API requests and errors

### Stripe Dashboard

1. Monitor payments, subscriptions, and failed charges
2. Set up email notifications for important events

---

## 🆘 Troubleshooting

### Authentication Not Working

- Verify Supabase URL and anon key in Vercel
- Check browser console for errors
- Verify RLS policies are enabled

### Payments Failing

- Verify Stripe keys match (test/live mode)
- Check webhook endpoint is accessible
- Verify webhook signature secret

### PDF Processing Slow

- Check Anthropic API rate limits
- Verify API key is valid
- Monitor Vercel function logs

---

## 📈 Scaling Tips

### Vercel Pro Features

Upgrade to Vercel Pro for:
- Longer function timeout (15 min vs 5 min)
- More bandwidth
- Better analytics

### Database Optimization

- Add indexes for frequently queried fields
- Use Supabase connection pooling
- Consider upgrading Supabase plan for more storage

### CDN for Assets

- Use Vercel's built-in CDN
- Optimize images and assets
- Enable compression

---

## 🎯 Next Steps

1. **Customize Branding**: Update colors, logo, and copy
2. **Add Analytics**: Google Analytics, Mixpanel, or PostHog
3. **Email Notifications**: SendGrid or Resend integration
4. **Custom Domain**: Add your domain in Vercel
5. **Marketing**: SEO, social media, content marketing

---

## 💡 Support

- **Supabase Docs**: https://supabase.com/docs
- **Stripe Docs**: https://stripe.com/docs
- **Vercel Docs**: https://vercel.com/docs

---

**🎉 Congratulations! Your SaaS is live!**

For questions or issues, check the logs and documentation above.
