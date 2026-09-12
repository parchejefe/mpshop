import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Calendar, RefreshCcw, User, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function RepurchaseSuggestions() {
  const { data: suggestions, isLoading } = trpc.customers.getRepurchaseSuggestions.useQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse bg-muted/50">
            <div className="h-32" />
          </Card>
        ))}
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <Card className="border-dashed bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <RefreshCcw className="mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="text-lg font-medium text-muted-foreground">No hay sugerencias para hoy</p>
          <p className="text-sm text-muted-foreground">Vuelve mañana para ver quién debería recomprar.</p>
        </CardContent>
      </Card>
    );
  }

  const handleWhatsApp = (s: any) => {
    const message = `Hola ${s.customerName}, te escribimos de MP Shop. 💻 Notamos que ya pasaron ${s.daysSinceLastOrder} días desde tu última compra. ¿Te gustaría consultar por nuevos equipos o accesorios? ¡Quedamos atentos! 😊`;
    const encodedMessage = encodeURIComponent(message);
    const phone = s.customerWhatsapp || s.customerPhone;
    if (!phone) return;
    
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    window.open(`https://wa.me/${cleanPhone}?text=${encodedMessage}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Sugerencias de Re-compra</h2>
          <p className="text-muted-foreground">Clientes que podrían necesitar stock pronto basándose en su frecuencia habitual.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map((s) => (
          <Card key={s.customerId} className="overflow-hidden border-blue-100 bg-white shadow-sm transition-all hover:shadow-md">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{s.customerName}</CardTitle>
                    <CardDescription className="text-xs">ID: {s.customerId}</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="font-medium text-muted-foreground">Frecuencia</p>
                  <p className="mt-1 flex items-center gap-1 font-bold text-slate-900 text-sm">
                    <RefreshCcw className="h-3 w-3 text-blue-500" />
                    Cada {s.avgDays} días
                  </p>
                </div>
                <div className="rounded-lg bg-orange-50 p-2">
                  <p className="font-medium text-muted-foreground">Sin comprar</p>
                  <p className="mt-1 flex items-center gap-1 font-bold text-orange-700 text-sm">
                    <Calendar className="h-3 w-3" />
                    {s.daysSinceLastOrder} días
                  </p>
                </div>
              </div>

              <div className="border-t border-dashed pt-3">
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                  Último pedido: {format(new Date(s.lastOrderDate), "d 'de' MMMM", { locale: es })}
                </p>
                <Button 
                  onClick={() => handleWhatsApp(s)}
                  className="w-full gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white border-none"
                >
                  <MessageSquare className="h-4 w-4" />
                  Contactar por WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
