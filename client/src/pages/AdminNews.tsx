import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Newspaper, Languages, CheckCircle, XCircle, Send, Globe, AlertTriangle, Loader2, Eye, Edit2 } from 'lucide-react';
import { format } from 'date-fns';

interface NewsTranslation {
  id: string;
  language: string;
  title: string;
  isApproved: boolean;
}

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  category: string;
  importance: string;
  source: string;
  publishedAt: string;
  translations: NewsTranslation[];
  translationCount: number;
  approvedCount: number;
}

interface PendingTranslation {
  id: string;
  newsId: string;
  language: string;
  title: string;
  summary: string;
  content: string;
  isApproved: boolean;
  originalTitle: string;
  originalSummary: string;
  category: string;
  importance: string;
}

function getImportanceBadge(importance: string) {
  switch (importance) {
    case 'critical':
      return <Badge variant="destructive">Critical</Badge>;
    case 'high':
      return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">High</Badge>;
    case 'medium':
      return <Badge variant="default">Medium</Badge>;
    case 'low':
      return <Badge variant="outline">Low</Badge>;
    default:
      return <Badge variant="outline">{importance}</Badge>;
  }
}

function getLanguageBadge(language: string) {
  switch (language) {
    case 'en':
      return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">EN</Badge>;
    case 'ar':
      return <Badge className="bg-green-500 hover:bg-green-600 text-white">AR</Badge>;
    case 'so':
      return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">SO</Badge>;
    default:
      return <Badge variant="outline">{language.toUpperCase()}</Badge>;
  }
}

export default function AdminNews() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('all-news');
  const [distributeDialogOpen, setDistributeDialogOpen] = useState(false);
  const [distributeNewsId, setDistributeNewsId] = useState<string | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewTranslation, setPreviewTranslation] = useState<PendingTranslation | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTranslation, setEditTranslation] = useState<PendingTranslation | null>(null);
  const [editForm, setEditForm] = useState({ title: '', summary: '', content: '' });
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveTranslationId, setApproveTranslationId] = useState<string | null>(null);

  const { data: newsArticles = [], isLoading: isLoadingNews } = useQuery<NewsArticle[]>({
    queryKey: ['/api/admin/news'],
  });

  const { data: pendingTranslations = [], isLoading: isLoadingPending } = useQuery<PendingTranslation[]>({
    queryKey: ['/api/admin/news/translations/pending'],
  });

  const translateMutation = useMutation({
    mutationFn: (newsId: string) => apiRequest('POST', `/api/admin/news/${newsId}/translate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news/translations/pending'] });
      toast({
        title: 'Translation Started',
        description: 'AI translation has been triggered for all languages.',
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Translation Failed',
        description: error.message || 'Failed to trigger AI translation.',
      });
    },
  });

  const distributeMutation = useMutation({
    mutationFn: (newsId: string) => apiRequest('POST', `/api/admin/news/${newsId}/distribute`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news'] });
      toast({
        title: 'Distribution Complete',
        description: 'News article has been distributed to all clients.',
      });
      setDistributeDialogOpen(false);
      setDistributeNewsId(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Distribution Failed',
        description: error.message || 'Failed to distribute the news article.',
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (translationId: string) => apiRequest('POST', `/api/admin/news/translations/${translationId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news/translations/pending'] });
      toast({
        title: 'Translation Approved',
        description: 'The translation has been approved successfully.',
      });
      setApproveDialogOpen(false);
      setApproveTranslationId(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Approval Failed',
        description: error.message || 'Failed to approve the translation.',
      });
    },
  });

  const updateTranslationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title: string; summary: string; content: string } }) =>
      apiRequest('PUT', `/api/admin/news/translations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/news/translations/pending'] });
      toast({
        title: 'Translation Updated',
        description: 'The translation has been updated successfully.',
      });
      setEditDialogOpen(false);
      setEditTranslation(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'Failed to update the translation.',
      });
    },
  });

  const handleOpenDistribute = (newsId: string) => {
    setDistributeNewsId(newsId);
    setDistributeDialogOpen(true);
  };

  const handleConfirmDistribute = () => {
    if (distributeNewsId) {
      distributeMutation.mutate(distributeNewsId);
    }
  };

  const handleOpenPreview = (translation: PendingTranslation) => {
    setPreviewTranslation(translation);
    setPreviewDialogOpen(true);
  };

  const handleOpenEdit = (translation: PendingTranslation) => {
    setEditTranslation(translation);
    setEditForm({
      title: translation.title,
      summary: translation.summary,
      content: translation.content,
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (editTranslation) {
      updateTranslationMutation.mutate({
        id: editTranslation.id,
        data: editForm,
      });
    }
  };

  const handleOpenApprove = (translationId: string) => {
    setApproveTranslationId(translationId);
    setApproveDialogOpen(true);
  };

  const handleConfirmApprove = () => {
    if (approveTranslationId) {
      approveMutation.mutate(approveTranslationId);
    }
  };

  const totalArticles = newsArticles.length;
  const translatedArticles = newsArticles.filter((a) => a.translationCount > 0).length;
  const fullyApprovedArticles = newsArticles.filter((a) => a.translationCount > 0 && a.approvedCount === a.translationCount).length;
  const pendingReviewCount = pendingTranslations.length;

  if (isLoadingNews && isLoadingPending) {
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
          <h1 className="text-3xl font-bold">News Translation & Distribution</h1>
          <p className="text-muted-foreground">Manage news articles, translations, and client distribution</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all-news" className="flex items-center gap-2">
            <Newspaper className="h-4 w-4" />
            All News
          </TabsTrigger>
          <TabsTrigger value="pending-translations" className="flex items-center gap-2">
            <Languages className="h-4 w-4" />
            Pending Translations
            {pendingReviewCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                {pendingReviewCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all-news" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Articles</CardTitle>
                <Newspaper className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalArticles}</div>
                <p className="text-xs text-muted-foreground">News articles in the system</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Translated</CardTitle>
                <Languages className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{translatedArticles}</div>
                <p className="text-xs text-muted-foreground">Articles with translations</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Fully Approved</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{fullyApprovedArticles}</div>
                <p className="text-xs text-muted-foreground">All translations approved</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{pendingReviewCount}</div>
                <p className="text-xs text-muted-foreground">Translations awaiting approval</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                All News Articles
              </CardTitle>
              <CardDescription>Manage translations and distribution for all news articles</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingNews ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : newsArticles.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Newspaper className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No news articles found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Importance</TableHead>
                        <TableHead>Translations</TableHead>
                        <TableHead>Published</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {newsArticles.map((article) => (
                        <TableRow key={article.id}>
                          <TableCell>
                            <div className="max-w-[300px]">
                              <div className="font-medium truncate">{article.title}</div>
                              <div className="text-xs text-muted-foreground truncate">{article.source}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{article.category}</Badge>
                          </TableCell>
                          <TableCell>
                            {getImportanceBadge(article.importance)}
                          </TableCell>
                          <TableCell>
                            {article.translationCount > 0 ? (
                              <div className="flex items-center gap-2">
                                {article.approvedCount === article.translationCount ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                                )}
                                <span className="text-sm">
                                  {article.approvedCount}/{article.translationCount} approved
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">No translations</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-muted-foreground">
                              {format(new Date(article.publishedAt), 'MMM d, yyyy')}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => translateMutation.mutate(article.id)}
                                disabled={translateMutation.isPending}
                              >
                                {translateMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Languages className="h-4 w-4 mr-1" />
                                )}
                                Translate
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleOpenDistribute(article.id)}
                              >
                                <Send className="h-4 w-4 mr-1" />
                                Distribute
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending-translations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="h-5 w-5" />
                Pending Translations
              </CardTitle>
              <CardDescription>Review and approve AI-generated translations before distribution</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingPending ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : pendingTranslations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No pending translations</p>
                  <p className="text-sm">All translations have been reviewed and approved.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Original Title</TableHead>
                        <TableHead>Language</TableHead>
                        <TableHead>Translated Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingTranslations.map((translation) => (
                        <TableRow key={translation.id}>
                          <TableCell>
                            <div className="max-w-[250px]">
                              <div className="font-medium truncate">{translation.originalTitle}</div>
                              <div className="text-xs text-muted-foreground truncate">{translation.originalSummary}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {getLanguageBadge(translation.language)}
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[250px] truncate text-sm">
                              {translation.title}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{translation.category}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleOpenPreview(translation)}
                                title="Preview"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleOpenEdit(translation)}
                                title="Edit"
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleOpenApprove(translation.id)}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Approve
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={distributeDialogOpen} onOpenChange={setDistributeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Distribute News Article
            </DialogTitle>
            <DialogDescription>
              This will distribute the news article to all clients. Are you sure you want to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistributeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmDistribute}
              disabled={distributeMutation.isPending}
            >
              {distributeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Distributing...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Confirm Distribution
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Translation Preview
            </DialogTitle>
            <DialogDescription>
              Review the AI-generated translation before approving
            </DialogDescription>
          </DialogHeader>
          {previewTranslation && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {getLanguageBadge(previewTranslation.language)}
                {getImportanceBadge(previewTranslation.importance)}
                <Badge variant="outline">{previewTranslation.category}</Badge>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Original Title</Label>
                <p className="text-sm bg-muted p-3 rounded-md">{previewTranslation.originalTitle}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Translated Title</Label>
                <p className="text-sm bg-muted p-3 rounded-md font-medium">{previewTranslation.title}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Translated Summary</Label>
                <p className="text-sm bg-muted p-3 rounded-md">{previewTranslation.summary}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Translated Content</Label>
                <div className="text-sm bg-muted p-3 rounded-md max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                  {previewTranslation.content}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialogOpen(false)}>
              Close
            </Button>
            {previewTranslation && (
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => {
                  setPreviewDialogOpen(false);
                  handleOpenApprove(previewTranslation.id);
                }}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5" />
              Edit Translation
            </DialogTitle>
            <DialogDescription>
              Make changes to the AI-generated translation before approving
            </DialogDescription>
          </DialogHeader>
          {editTranslation && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {getLanguageBadge(editTranslation.language)}
                <Badge variant="outline">{editTranslation.category}</Badge>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Original Title</Label>
                <p className="text-sm bg-muted p-3 rounded-md">{editTranslation.originalTitle}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-title">Translated Title</Label>
                <Input
                  id="edit-title"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-summary">Translated Summary</Label>
                <Textarea
                  id="edit-summary"
                  value={editForm.summary}
                  onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-content">Translated Content</Label>
                <Textarea
                  id="edit-content"
                  value={editForm.content}
                  onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                  rows={6}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateTranslationMutation.isPending}
            >
              {updateTranslationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Approve Translation
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to approve this translation? Once approved, it will be available for distribution to clients.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleConfirmApprove}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Confirm Approval
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
