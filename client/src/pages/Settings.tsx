import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  MapPin,
  Phone,
  ImageIcon,
  Shield,
  FileText,
  Save,
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  Trash2,
} from "lucide-react";

export default function Settings() {
  const { user } = useAuth();

  // Solo admins
  if (!user || user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-red-600 mb-2">Acceso Denegado</h2>
        <p className="text-muted-foreground mb-4">Solo los administradores pueden acceder a la configuración de empresa.</p>
        <Link href="/">
          <Button variant="outline"><ChevronLeft className="h-4 w-4 mr-1" />Volver al Inicio</Button>
        </Link>
      </div>
    );
  }

  const { data: companyConfig, isLoading } = trpc.settings.getCompanyConfig.useQuery();
  const utils = trpc.useUtils();
  const updateMutation = trpc.settings.updateCompanyConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuración guardada correctamente");
      utils.settings.getCompanyConfig.invalidate();
    },
    onError: (err: any) => {
      toast.error(err.message || "Error al guardar configuración");
    },
  });

  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const resetMutation = trpc.settings.resetAllTestData.useMutation({
    onSuccess: (res) => {
      toast.success(res.message || "Todos los datos de prueba han sido borrados con éxito.");
      setIsResetDialogOpen(false);
      utils.invalidate();
    },
    onError: (err: any) => {
      toast.error(err.message || "Error al reiniciar datos");
    },
  });

  // Form state
  const [form, setForm] = useState({
    name: "",
    subName: "",
    slogan: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    city: "",
    taxId: "",
    logo: null as string | null,
    tiktokUrl: "",
    warrantyBadge: "",
    shippingBadge: "",
    qualityBadge: "",
    receiptFooterNotes: "",
  });

  // Sync form when data loads
  useEffect(() => {
    if (companyConfig) {
      setForm({
        name: companyConfig.name || "",
        subName: companyConfig.subName || "",
        slogan: companyConfig.slogan || "",
        phone: companyConfig.phone || "",
        whatsapp: companyConfig.whatsapp || "",
        email: companyConfig.email || "",
        address: companyConfig.address || "",
        city: companyConfig.city || "",
        taxId: companyConfig.taxId || "",
        logo: companyConfig.logo || null,
        tiktokUrl: companyConfig.tiktokUrl || "",
        warrantyBadge: companyConfig.warrantyBadge || "",
        shippingBadge: companyConfig.shippingBadge || "",
        qualityBadge: companyConfig.qualityBadge || "",
        receiptFooterNotes: companyConfig.receiptFooterNotes || "",
      });
    }
  }, [companyConfig]);

  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El logo no debe superar 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm(f => ({ ...f, logo: ev.target?.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    updateMutation.mutate(form);
  };

  const field = (key: keyof typeof form) => ({
    value: (form[key] as string) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value })),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando configuración...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              Inicio
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Configuración de Empresa
            </h1>
            <p className="text-sm text-muted-foreground">
              Estos datos aparecen en fichas comerciales, catálogos, recibos y garantías.
            </p>
          </div>
        </div>

      </div>

      <Tabs defaultValue="identity" className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="identity" className="gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Identidad</span>
          </TabsTrigger>
          <TabsTrigger value="contact" className="gap-1.5 text-xs">
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Contacto</span>
          </TabsTrigger>
          <TabsTrigger value="logo" className="gap-1.5 text-xs">
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Logo</span>
          </TabsTrigger>
          <TabsTrigger value="badges" className="gap-1.5 text-xs">
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Insignias</span>
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Documentos</span>
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB: Identidad Corporativa ─── */}
        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Identidad Corporativa
              </CardTitle>
              <CardDescription>
                Nombre comercial, razón social y slogan que aparecen en todos los documentos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre Comercial *</Label>
                  <Input id="name" placeholder="Ej: HK EQUIPOS TECNOLÓGICOS" {...field("name")} />
                  <p className="text-xs text-muted-foreground">Aparece como título principal en fichas y catálogos.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subName">Subtítulo / Marca</Label>
                  <Input id="subName" placeholder="Ej: MP SHOP - CONTROL & VENTAS" {...field("subName")} />
                  <p className="text-xs text-muted-foreground">Segunda línea de la cabecera de documentos.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="slogan">Eslogan Comercial</Label>
                <Input
                  id="slogan"
                  placeholder="Ej: Tecnología que conecta contigo · Equipos Garantizados"
                  {...field("slogan")}
                />
                <p className="text-xs text-muted-foreground">Frase destacada en fichas comerciales y catálogos.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxId">NIT / RUC / CI Fiscal</Label>
                <Input id="taxId" placeholder="Ej: 1234567890" {...field("taxId")} />
                <p className="text-xs text-muted-foreground">Número tributario impreso en recibos y comprobantes.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tiktokUrl">Usuario / Enlace TikTok</Label>
                <Input id="tiktokUrl" placeholder="Ej: https://www.tiktok.com/@tutienda" {...field("tiktokUrl")} />
                <p className="text-xs text-muted-foreground">Enlace por defecto para el QR de TikTok en las fichas cuando el producto no tiene video propio.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB: Ubicación & Contacto ─── */}
        <TabsContent value="contact">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Ubicación & Contacto
              </CardTitle>
              <CardDescription>
                Dirección, teléfonos y email que aparecen en recibos, fichas y catálogos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="address">Dirección Física</Label>
                <Input id="address" placeholder="Ej: Centro Comercial Tecnológico, Local 15" {...field("address")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Ciudad / Departamento</Label>
                <Input id="city" placeholder="Ej: La Paz, Bolivia" {...field("city")} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> Teléfono / Fijo
                  </Label>
                  <Input id="phone" placeholder="Ej: +591 2 XXXXXXX" {...field("phone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp" className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-green-500" /> WhatsApp Business
                  </Label>
                  <Input id="whatsapp" placeholder="Ej: +591 70000000" {...field("whatsapp")} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email de Contacto</Label>
                <Input id="email" type="email" placeholder="Ej: ventas@tuempresa.com" {...field("email")} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB: Logo ─── */}
        <TabsContent value="logo">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-primary" />
                Logo de la Empresa
              </CardTitle>
              <CardDescription>
                El logo aparece en fichas comerciales, catálogos, recibos de venta y garantías. Tamaño máximo: 2 MB. Formatos: PNG, JPG, SVG, WebP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Preview */}
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-64 h-40 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center bg-slate-50 overflow-hidden cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {form.logo ? (
                    <img
                      src={form.logo}
                      alt="Logo de empresa"
                      className="max-h-full max-w-full object-contain p-2"
                    />
                  ) : (
                    <div className="text-center text-muted-foreground p-4">
                      <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-medium">Click para subir logo</p>
                      <p className="text-xs opacity-60 mt-1">PNG, JPG, SVG — Máx. 2 MB</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => logoInputRef.current?.click()}
                    className="gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    {form.logo ? "Cambiar Logo" : "Subir Logo"}
                  </Button>
                  {form.logo && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setForm(f => ({ ...f, logo: null }))}
                      className="gap-2"
                    >
                      <X className="h-4 w-4" />
                      Eliminar Logo
                    </Button>
                  )}
                </div>

                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </div>

              {form.logo && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-700">Logo cargado correctamente. Haz clic en "Guardar Cambios" para aplicar.</p>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700">
                  💡 <strong>Consejo:</strong> Usa un logo con fondo transparente (PNG) para mejores resultados en documentos y fichas comerciales. Tamaño recomendado: 400×200 px o superior.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB: Insignias Comerciales ─── */}
        <TabsContent value="badges">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Insignias Comerciales de Confianza
              </CardTitle>
              <CardDescription>
                Estos textos aparecen como sellos o badges en las fichas comerciales y catálogos para generar confianza.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="warrantyBadge" className="flex items-center gap-1.5">
                  🛡️ Garantía
                </Label>
                <Input
                  id="warrantyBadge"
                  placeholder="Ej: Garantía Real & Soporte Especializado"
                  {...field("warrantyBadge")}
                />
                <p className="text-xs text-muted-foreground">Texto del sello de garantía en fichas y catálogos.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shippingBadge" className="flex items-center gap-1.5">
                  📦 Envíos
                </Label>
                <Input
                  id="shippingBadge"
                  placeholder="Ej: Envíos asegurados a todo el país"
                  {...field("shippingBadge")}
                />
                <p className="text-xs text-muted-foreground">Texto del sello de envíos y distribución.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qualityBadge" className="flex items-center gap-1.5">
                  ✅ Calidad
                </Label>
                <Input
                  id="qualityBadge"
                  placeholder="Ej: Equipos 100% probados y verificados"
                  {...field("qualityBadge")}
                />
                <p className="text-xs text-muted-foreground">Texto del sello de control de calidad.</p>
              </div>

              {/* Preview */}
              <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Vista Previa de Sellos</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { emoji: "🛡️", text: form.warrantyBadge, color: "bg-blue-100 text-blue-800 border-blue-200" },
                    { emoji: "📦", text: form.shippingBadge, color: "bg-green-100 text-green-800 border-green-200" },
                    { emoji: "✅", text: form.qualityBadge, color: "bg-amber-100 text-amber-800 border-amber-200" },
                  ].map((badge, i) => (
                    badge.text && (
                      <div key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${badge.color}`}>
                        <span>{badge.emoji}</span>
                        <span>{badge.text}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB: Documentos / Recibos ─── */}
        <TabsContent value="docs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Textos para Documentos & Recibos
              </CardTitle>
              <CardDescription>
                Notas legales y textos de pie de página que aparecen en recibos de venta, garantías y comprobantes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="receiptFooterNotes">Pie de Página / Notas Legales</Label>
                <Textarea
                  id="receiptFooterNotes"
                  placeholder="Ej: Gracias por su preferencia. Este comprobante es válido como garantía de compra. No se aceptan devoluciones después de 24 horas..."
                  rows={5}
                  value={form.receiptFooterNotes}
                  onChange={(e) => setForm(f => ({ ...f, receiptFooterNotes: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Aparece al final de recibos de venta, tickets y comprobantes de garantía.</p>
              </div>

              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Vista Previa del Pie de Página</p>
                <div className="text-xs text-slate-600 italic border-t border-dashed border-slate-300 pt-2">
                  {form.receiptFooterNotes || <span className="text-slate-400">Sin texto definido...</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Zona de Peligro: Reiniciar Datos de Prueba ─── */}
      <Card className="border-red-200 bg-red-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700 text-lg">
            <Trash2 className="h-5 w-5 text-red-600" />
            Zona de Pruebas: Reiniciar Base de Datos
          </CardTitle>
          <CardDescription className="text-red-700/80">
            ¿Deseas probar el software completamente desde cero? Este botón elimina de forma segura todas las unidades de inventario, ventas, órdenes de taller, pedidos, garantías y movimientos de prueba.
            <strong className="block mt-1 text-slate-800">Tus usuarios administradores, sucursales y datos de empresa se mantienen 100% seguros e intactos.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                className="gap-2 bg-red-600 hover:bg-red-700 text-white font-bold shadow-sm"
              >
                <Trash2 className="h-4 w-4" />
                Borrar Todo y Empezar de Cero
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  ¿Estás seguro de borrar todos los datos de prueba?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-slate-600 space-y-2">
                  <p>
                    Esta acción vaciará completamente las tablas de <strong>unidades, ventas, pedidos, taller, comprobantes, garantías y gastos</strong> para que puedas registrar tus propios equipos y probar el software en limpio.
                  </p>
                  <p className="font-semibold text-slate-800">
                    Los usuarios del sistema y la configuración de tu empresa NO se eliminarán.
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resetMutation.isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    resetMutation.mutate();
                  }}
                  disabled={resetMutation.isPending}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold"
                >
                  {resetMutation.isPending ? "Borrando datos..." : "Sí, Borrar Todo"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Save Footer */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="gap-2 bg-primary text-white"
          size="lg"
        >
          {updateMutation.isPending ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {updateMutation.isPending ? "Guardando..." : "Guardar Cambios"}
        </Button>
      </div>
    </div>
  );
}
