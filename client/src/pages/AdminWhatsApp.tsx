import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Smartphone,
  Wifi,
  WifiOff,
  QrCode,
  Send,
  Settings,
  MessageSquare,
  Clock,
  Shield,
  Loader2,
  RefreshCw,
  CheckCircle,
} from 'lucide-react';

interface WhatsAppStatus {
  status: string;
  phoneNumber?: string;
  pushName?: string;
  qrCode?: string;
  messagesSentToday?: number;
  dailyLimit?: number;
}

interface QrResponse {
  status: string;
  qrDataUrl?: string;
  message?: string;
}

interface WhatsAppSettings {
  dailyMessageLimit: number;
  messageDelayMs: number;
  businessHoursStart: number;
  businessHoursEnd: number;
  timezone: string;
  messagesSentToday: number;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'connected':
      return <Badge className="bg-green-500 hover:bg-green-600 text-white">Connected</Badge>;
    case 'connecting':
      return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Connecting...</Badge>;
    case 'qr_ready':
      return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">QR Ready</Badge>;
    case 'disconnected':
    default:
      return <Badge variant="secondary">Disconnected</Badge>;
  }
}

function getStatusIndicator(status: string) {
  switch (status) {
    case 'connected':
      return <div className="w-4 h-4 rounded-full bg-green-500 animate-pulse" />;
    case 'connecting':
      return <div className="w-4 h-4 rounded-full bg-amber-500 animate-pulse" />;
    case 'qr_ready':
      return <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse" />;
    case 'disconnected':
    default:
      return <div className="w-4 h-4 rounded-full bg-gray-400" />;
  }
}

export default function AdminWhatsApp() {
  const { toast } = useToast();
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [settingsForm, setSettingsForm] = useState({
    dailyMessageLimit: 100,
    messageDelayMs: 1000,
    businessHoursStart: 9,
    businessHoursEnd: 17,
  });

  const { data: status, isLoading: statusLoading } = useQuery<WhatsAppStatus>({
    queryKey: ['/api/admin/whatsapp-web/status'],
    refetchInterval: 5000,
  });

  const { data: qrData } = useQuery<QrResponse>({
    queryKey: ['/api/admin/whatsapp-web/qr'],
    refetchInterval: status?.status === 'qr_ready' ? 3000 : false,
    enabled: status?.status !== 'connected',
  });

  const { data: settings } = useQuery<WhatsAppSettings>({
    queryKey: ['/api/admin/whatsapp-web/settings'],
  });

  useEffect(() => {
    if (settings) {
      setSettingsForm({
        dailyMessageLimit: settings.dailyMessageLimit,
        messageDelayMs: settings.messageDelayMs,
        businessHoursStart: settings.businessHoursStart,
        businessHoursEnd: settings.businessHoursEnd,
      });
    }
  }, [settings]);

  const connectMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/whatsapp-web/connect'),
    onSuccess: () => {
      toast({ title: 'Connection initiated', description: 'WhatsApp Web connection is being established.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/whatsapp-web/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/whatsapp-web/qr'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Connection failed', description: error.message, variant: 'destructive' });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/whatsapp-web/disconnect'),
    onSuccess: () => {
      toast({ title: 'Disconnected', description: 'WhatsApp Web has been disconnected.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/whatsapp-web/status'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Disconnect failed', description: error.message, variant: 'destructive' });
    },
  });

  const testMessageMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/whatsapp-web/test', { phone: testPhone, message: testMessage }),
    onSuccess: () => {
      toast({ title: 'Test message sent', description: `Message sent to ${testPhone} successfully.` });
      setTestPhone('');
      setTestMessage('');
      queryClient.invalidateQueries({ queryKey: ['/api/admin/whatsapp-web/status'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to send test message', description: error.message, variant: 'destructive' });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: () => apiRequest('PUT', '/api/admin/whatsapp-web/settings', settingsForm),
    onSuccess: () => {
      toast({ title: 'Settings saved', description: 'WhatsApp settings have been updated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/whatsapp-web/settings'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save settings', description: error.message, variant: 'destructive' });
    },
  });

  const currentStatus = status?.status || 'disconnected';
  const isConnected = currentStatus === 'connected';
  const isConnecting = currentStatus === 'connecting';
  const messagesSentToday = status?.messagesSentToday ?? settings?.messagesSentToday ?? 0;
  const dailyLimit = status?.dailyLimit ?? settings?.dailyMessageLimit ?? 100;
  const usagePercent = dailyLimit > 0 ? Math.min((messagesSentToday / dailyLimit) * 100, 100) : 0;

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">WhatsApp Admin Panel</h1>
          <p className="text-muted-foreground">Manage WhatsApp Web connection and messaging settings</p>
        </div>
        <div className="flex items-center gap-3">
          {getStatusBadge(currentStatus)}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Connection Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Connection Status
              </CardTitle>
              <CardDescription>WhatsApp Web session information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
                  {getStatusIndicator(currentStatus)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {isConnected ? (
                      <Wifi className="h-4 w-4 text-green-500" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium capitalize">{currentStatus.replace('_', ' ')}</span>
                  </div>
                  {isConnected && status?.phoneNumber && (
                    <p className="text-sm text-muted-foreground">Phone: {status.phoneNumber}</p>
                  )}
                  {isConnected && status?.pushName && (
                    <p className="text-sm text-muted-foreground">Name: {status.pushName}</p>
                  )}
                  {!isConnected && !isConnecting && (
                    <p className="text-sm text-muted-foreground">No active session</p>
                  )}
                  {isConnecting && (
                    <p className="text-sm text-muted-foreground">Establishing connection...</p>
                  )}
                </div>
              </div>

              <Separator />

              <div className="flex gap-2">
                {isConnected ? (
                  <Button
                    variant="destructive"
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    className="w-full"
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <WifiOff className="h-4 w-4 mr-2" />
                    )}
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    onClick={() => connectMutation.mutate()}
                    disabled={connectMutation.isPending || isConnecting}
                    className="w-full"
                  >
                    {connectMutation.isPending || isConnecting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wifi className="h-4 w-4 mr-2" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* QR Code Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5" />
                QR Code
              </CardTitle>
              <CardDescription>Scan with WhatsApp to connect</CardDescription>
            </CardHeader>
            <CardContent>
              {isConnected ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                  <p className="font-medium text-green-700">Already Connected</p>
                  <p className="text-sm text-muted-foreground mt-1">WhatsApp Web is active and ready</p>
                </div>
              ) : currentStatus === 'qr_ready' && qrData?.qrDataUrl ? (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <div className="border rounded-lg p-4 bg-white mb-4">
                    <img
                      src={qrData.qrDataUrl}
                      alt="WhatsApp QR Code"
                      className="w-64 h-64 object-contain"
                    />
                  </div>
                  <p className="font-medium">Scan with WhatsApp</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Open WhatsApp on your phone, go to Settings &gt; Linked Devices &gt; Link a Device
                  </p>
                  <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    QR code refreshes automatically
                  </div>
                </div>
              ) : isConnecting ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="h-12 w-12 text-amber-500 mb-3 animate-spin" />
                  <p className="font-medium">Connecting...</p>
                  <p className="text-sm text-muted-foreground mt-1">Waiting for QR code to be generated</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <QrCode className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="font-medium text-muted-foreground">Not Connected</p>
                  <p className="text-sm text-muted-foreground mt-1">Click Connect above to generate a QR code</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Test Message Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Test Message
              </CardTitle>
              <CardDescription>Send a test message to verify the connection</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="test-phone">Phone Number</Label>
                <Input
                  id="test-phone"
                  placeholder="e.g. +1234567890"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  disabled={!isConnected}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-message">Message</Label>
                <textarea
                  id="test-message"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Type your test message here..."
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  disabled={!isConnected}
                />
              </div>
              <Button
                onClick={() => testMessageMutation.mutate()}
                disabled={!isConnected || !testPhone.trim() || !testMessage.trim() || testMessageMutation.isPending}
                className="w-full"
              >
                {testMessageMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Send Test Message
              </Button>
              {!isConnected && (
                <p className="text-xs text-muted-foreground text-center">
                  Connect to WhatsApp first to send test messages
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Stats Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Message Statistics
              </CardTitle>
              <CardDescription>Daily message usage overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Messages Sent Today</span>
                <span className="text-sm text-muted-foreground">
                  {messagesSentToday} / {dailyLimit}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-500 ${
                    usagePercent >= 90
                      ? 'bg-red-500'
                      : usagePercent >= 70
                        ? 'bg-amber-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{Math.round(usagePercent)}% used</span>
                <span>{dailyLimit}</span>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">{messagesSentToday}</div>
                  <div className="text-xs text-muted-foreground">Sent Today</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">{Math.max(dailyLimit - messagesSentToday, 0)}</div>
                  <div className="text-xs text-muted-foreground">Remaining</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Settings
              </CardTitle>
              <CardDescription>Configure WhatsApp messaging behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="daily-limit" className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  Daily Message Limit
                </Label>
                <Input
                  id="daily-limit"
                  type="number"
                  min={1}
                  value={settingsForm.dailyMessageLimit}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      dailyMessageLimit: parseInt(e.target.value) || 0,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Maximum number of messages that can be sent per day
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="message-delay" className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Message Delay (ms)
                </Label>
                <Input
                  id="message-delay"
                  type="number"
                  min={0}
                  step={100}
                  value={settingsForm.messageDelayMs}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      messageDelayMs: parseInt(e.target.value) || 0,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Delay between consecutive messages in milliseconds
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Business Hours
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="hours-start" className="text-xs text-muted-foreground">
                      Start Hour (0-23)
                    </Label>
                    <Input
                      id="hours-start"
                      type="number"
                      min={0}
                      max={23}
                      value={settingsForm.businessHoursStart}
                      onChange={(e) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          businessHoursStart: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hours-end" className="text-xs text-muted-foreground">
                      End Hour (1-24)
                    </Label>
                    <Input
                      id="hours-end"
                      type="number"
                      min={1}
                      max={24}
                      value={settingsForm.businessHoursEnd}
                      onChange={(e) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          businessHoursEnd: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Messages will only be sent during business hours ({settingsForm.businessHoursStart}:00 - {settingsForm.businessHoursEnd}:00)
                </p>
              </div>

              <Separator />

              <Button
                onClick={() => saveSettingsMutation.mutate()}
                disabled={saveSettingsMutation.isPending}
                className="w-full"
              >
                {saveSettingsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Settings className="h-4 w-4 mr-2" />
                )}
                Save Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
