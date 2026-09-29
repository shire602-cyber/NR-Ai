import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileSearch, Home, ArrowLeft } from "lucide-react";
import { messages as pageMessages } from "./not-found.i18n";

export default function NotFound() {
  const tr = pageMessages.useT();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-10 pb-8 flex flex-col items-center text-center">
          <div className="p-4 rounded-full bg-muted mb-6">
            <FileSearch className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{tr("pageNotFound")}</h1>
          <p className="text-muted-foreground mb-8 max-w-xs">{tr("thePageYouReLookingFor")}</p>
          <div className="flex gap-3 w-full">
            <Button variant="outline" onClick={() => window.history.back()} className="flex-1">
              <ArrowLeft className="h-4 w-4 me-2" />
              {tr("goBack")}
            </Button>
            <Link href="/dashboard">
              <Button className="flex-1">
                <Home className="h-4 w-4 me-2" />
                {tr("dashboard")}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
