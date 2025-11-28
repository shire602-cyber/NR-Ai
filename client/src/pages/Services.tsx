import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
import { 
  FileText,
  FileCheck,
  FileX,
  Calculator,
  BookOpen,
  Sparkles,
  BarChart3,
  Shield,
  CheckCircle2,
  ArrowRight,
  Globe,
  Users,
  Building2,
  Briefcase,
  Store,
  Home,
  Rocket,
  Phone,
  MessageSquare,
  Award,
  Clock,
  Handshake,
  Languages
} from 'lucide-react';
import { useState, useEffect } from 'react';

export default function Services() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const coreServices = [
    {
      icon: FileText,
      title: 'VAT Registration & Filing',
      description: 'Complete VAT registration with FTA and ongoing quarterly/monthly filing support.',
      color: 'from-blue-500 to-cyan-600',
      bgColor: 'bg-blue-500/10',
    },
    {
      icon: Building2,
      title: 'Corporate Tax Registration',
      description: 'UAE Corporate Tax registration and compliance setup for businesses over AED 375,000.',
      color: 'from-purple-500 to-violet-600',
      bgColor: 'bg-purple-500/10',
    },
    {
      icon: FileX,
      title: 'VAT Deregistration',
      description: 'Smooth VAT deregistration process when your business no longer meets thresholds.',
      color: 'from-red-500 to-rose-600',
      bgColor: 'bg-red-500/10',
    },
    {
      icon: FileCheck,
      title: 'Corporate Tax Deregistration',
      description: 'Complete corporate tax deregistration for business closures or restructuring.',
      color: 'from-orange-500 to-amber-600',
      bgColor: 'bg-orange-500/10',
    },
    {
      icon: Calculator,
      title: 'VAT & Tax Return Filing',
      description: 'Accurate and timely VAT and Corporate Tax return preparation and submission.',
      color: 'from-green-500 to-emerald-600',
      bgColor: 'bg-green-500/10',
    },
    {
      icon: BookOpen,
      title: 'Books Cleanup & Catch-up',
      description: 'Bring your books up to date with historical data entry and reconciliation.',
      color: 'from-teal-500 to-cyan-600',
      bgColor: 'bg-teal-500/10',
    },
    {
      icon: Sparkles,
      title: 'AI-Powered Bookkeeping',
      description: 'Modern bookkeeping with AI automation for expense categorization and data entry.',
      color: 'from-violet-500 to-purple-600',
      bgColor: 'bg-violet-500/10',
    },
    {
      icon: BarChart3,
      title: 'Financial Statement Preparation',
      description: 'Professional P&L statements, balance sheets, and cash flow reports.',
      color: 'from-indigo-500 to-blue-600',
      bgColor: 'bg-indigo-500/10',
    },
    {
      icon: Shield,
      title: 'Compliance Review & Audit Support',
      description: 'Pre-audit reviews and support during FTA audits and compliance checks.',
      color: 'from-emerald-500 to-green-600',
      bgColor: 'bg-emerald-500/10',
    },
  ];

  const whyChooseUs = [
    {
      icon: Award,
      title: 'Registered Firm Since 2017',
      description: 'Licensed accounting firm operating in Dubai with years of proven expertise.',
    },
    {
      icon: Sparkles,
      title: 'AI + Human Expertise',
      description: 'Best of both worlds - AI automation backed by experienced accountants.',
    },
    {
      icon: Shield,
      title: 'FTA Compliant',
      description: 'All services aligned with UAE Federal Tax Authority requirements.',
    },
    {
      icon: Languages,
      title: 'Bilingual Support',
      description: 'Full support in English and Arabic for seamless communication.',
    },
  ];

  const clientTypes = [
    { icon: Briefcase, title: 'Freelancers' },
    { icon: Store, title: 'SMEs' },
    { icon: Store, title: 'E-commerce Businesses' },
    { icon: Building2, title: 'Holding Companies' },
    { icon: Home, title: 'Real Estate & Construction' },
    { icon: Rocket, title: 'Startups & Tech Firms' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 lg:py-32">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 dark:from-primary/10 dark:via-transparent dark:to-accent/10" />
        <div className="absolute inset-0 bg-grid-white/5 dark:bg-grid-white/5" style={{ backgroundSize: '40px 40px' }} />
        
        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
          <div className={`text-center max-w-4xl mx-auto ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '600ms' }}>
            <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 px-4 py-1.5" data-testid="badge-hero">
              <Award className="w-4 h-4 mr-2" />
              Dubai-Based Accounting Firm
            </Badge>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 tracking-tight" data-testid="text-hero-headline">
              <span className="bg-gradient-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
                Accounting & Tax Services
              </span>
              <br />
              <span className="text-foreground">Backed by Experts</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed" data-testid="text-hero-subheadline">
              Operating in Dubai since 2017 — combining human expertise with AI automation for modern UAE businesses.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link href="/register">
                <Button size="lg" className="gap-2 px-8 py-6 text-lg" data-testid="button-book-consultation">
                  <Phone className="w-5 h-5" />
                  Book a Free Consultation
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="gap-2 px-8 py-6 text-lg" data-testid="button-get-started">
                  Get Started
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
            
            <p className="mt-6 text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Shield className="w-4 h-4" />
              Licensed & Registered in Dubai, UAE
            </p>
          </div>
        </div>
      </section>

      {/* Core Services Section */}
      <section className="py-20 lg:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '100ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-accent/10 text-accent border-accent/20 px-4 py-1.5" data-testid="badge-services">
              Our Services
            </Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4" data-testid="text-services-headline">
              Featured Core Services
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Comprehensive accounting and tax solutions tailored for UAE businesses
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coreServices.map((service, index) => (
              <Card 
                key={service.title}
                className={`p-6 hover-elevate transition-all duration-300 group overflow-hidden relative border-border/50 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${150 + index * 50}ms`, animationDuration: '600ms' }}
                data-testid={`card-service-${index}`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/5 dark:from-white/0 dark:via-white/0 dark:to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                <div className={`w-14 h-14 rounded-xl ${service.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform relative z-10`}>
                  <service.icon className={`w-7 h-7 bg-gradient-to-br ${service.color} bg-clip-text text-transparent`} style={{ color: `hsl(var(--primary))` }} />
                </div>
                
                <h3 className="text-xl font-semibold mb-2 relative z-10 group-hover:text-primary transition-colors" data-testid={`text-service-title-${index}`}>
                  {service.title}
                </h3>
                
                <p className="text-muted-foreground relative z-10 leading-relaxed" data-testid={`text-service-description-${index}`}>
                  {service.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us Section */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '200ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 px-4 py-1.5" data-testid="badge-why-choose">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Why Choose Us
            </Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4" data-testid="text-why-choose-headline">
              Your Trusted Partner
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Experience the difference with our proven track record and modern approach
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyChooseUs.map((item, index) => (
              <div 
                key={item.title}
                className={`text-center p-6 rounded-2xl border bg-card hover-elevate transition-all duration-300 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${250 + index * 75}ms`, animationDuration: '600ms' }}
                data-testid={`card-why-${index}`}
              >
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2" data-testid={`text-why-title-${index}`}>
                  {item.title}
                </h3>
                <p className="text-sm text-muted-foreground" data-testid={`text-why-description-${index}`}>
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Client Types Section */}
      <section className="py-20 lg:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className={`text-center mb-16 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '300ms', animationDuration: '600ms' }}>
            <Badge className="mb-4 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 px-4 py-1.5" data-testid="badge-clients">
              <Users className="w-4 h-4 mr-2" />
              Who We Serve
            </Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4" data-testid="text-clients-headline">
              Client Types We Serve
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From freelancers to enterprises, we support businesses of all sizes
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {clientTypes.map((client, index) => (
              <div 
                key={client.title}
                className={`flex flex-col items-center p-6 rounded-xl border bg-card hover-elevate transition-all duration-300 group ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`}
                style={{ animationDelay: `${350 + index * 50}ms`, animationDuration: '600ms' }}
                data-testid={`card-client-${index}`}
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <client.icon className="w-6 h-6 text-primary" />
                </div>
                <span className="text-sm font-medium text-center" data-testid={`text-client-${index}`}>
                  {client.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 dark:from-primary/20 dark:via-accent/10 dark:to-primary/20" />
        <div className="absolute inset-0 bg-grid-white/5 dark:bg-grid-white/5" style={{ backgroundSize: '40px 40px' }} />
        
        <div className={`relative z-10 max-w-4xl mx-auto px-6 lg:px-8 text-center ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '400ms', animationDuration: '600ms' }}>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6" data-testid="text-cta-headline">
            Need help with VAT or Tax Setup?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Get expert guidance from our Dubai-based accounting team. We'll help you navigate UAE tax regulations with confidence.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/register">
              <Button size="lg" className="gap-2 px-8 py-6 text-lg" data-testid="button-cta-consultation">
                <Phone className="w-5 h-5" />
                Book a Free Consultation
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="gap-2 px-8 py-6 text-lg backdrop-blur-sm" data-testid="button-cta-expert">
                <MessageSquare className="w-5 h-5" />
                Talk to an Expert
              </Button>
            </Link>
          </div>
          
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Free initial consultation
            </span>
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              Response within 24 hours
            </span>
            <span className="flex items-center gap-2">
              <Handshake className="w-4 h-4 text-purple-500" />
              No commitment required
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
