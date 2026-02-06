import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { stylistService, Stylist } from "@/services/stylistService";
import { styleService, Style } from "@/services/styleService";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const stylistSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  address: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
  skillLevel: z.string().min(1, "Skill level is required"),
  surcharge: z.coerce.number().min(0, "Surcharge must be positive").default(0),
  styleSurcharges: z.record(z.string(), z.coerce.number()).default({}),
  workingHours: z.record(z.string(), z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    isOpen: z.boolean()
  })).optional(),
  isActive: z.boolean().default(true),
  styleIds: z.array(z.string()).default([]),
});

type StylistFormValues = z.infer<typeof stylistSchema>;

const Stylists = () => {
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [availableStyles, setAvailableStyles] = useState<Style[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStylist, setEditingStylist] = useState<Stylist | null>(null);
  
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DEFAULT_HOURS = { start: "09:00", end: "22:00", isOpen: true };

  // Pagination & Search states
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const form = useForm<StylistFormValues>({
    resolver: zodResolver(stylistSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      address: "",
      password: "",
      skillLevel: "Intermediate",
      surcharge: 0,
      isActive: true,
    },
  });

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // Reset to page 1 on new search
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchStylists = async () => {
    setIsLoading(true);
    try {
      const response = await stylistService.getAllStylists({
        page,
        limit: 10,
        search: debouncedSearch,
      });
      setStylists(response.data);
      setTotalPages(response.meta.totalPages);
    } catch (error) {
      toast.error("Failed to fetch stylists");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStylists();
    fetchStyles();
  }, [page, debouncedSearch]);

  const fetchStyles = async () => {
      try {
          const res = await styleService.getAllStyles({ limit: 100 });
          setAvailableStyles(res.data);
      } catch (error) {
          console.error("Failed to load styles", error);
      }
  };

  const onSubmit = async (data: StylistFormValues) => {
    setIsSubmitting(true);
    try {
      if (editingStylist) {
        // Remove password if empty during edit
        const updateData = { ...data };
        if (!updateData.password) delete updateData.password;
        
        await stylistService.updateStylist(editingStylist.id, updateData);
        toast.success("Stylist updated successfully");
      } else {
        if (!data.password) {
            form.setError("password", { message: "Password is required for new stylists" });
            setIsSubmitting(false);
            return;
        }
        await stylistService.createStylist(data);
        toast.success("Stylist created successfully");
      }
      setIsDialogOpen(false);
      fetchStylists();
      form.reset();
      setEditingStylist(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to save stylist");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this stylist? This action cannot be undone.")) {
      try {
        await stylistService.deleteStylist(id);
        toast.success("Stylist deleted successfully");
        fetchStylists();
      } catch (error) {
        toast.error("Failed to delete stylist");
      }
    }
  };

  const handleEdit = (stylist: Stylist) => {
    setEditingStylist(stylist);

    // Prepare working hours with defaults if missing
    const workingHours = { ...(stylist.workingHours || {}) };
    DAYS.forEach(day => {
        if (!workingHours[day]) {
            workingHours[day] = { isOpen: true, start: "09:00", end: "22:00" };
        }
    });

    form.reset({
      fullName: stylist.fullName,
      email: stylist.email,
      phone: stylist.phone || "",
      address: stylist.address || "",
      password: "",
      skillLevel: stylist.skillLevel,
      surcharge: Number(stylist.surcharge) || 0,
      styleSurcharges: stylist.styleSurcharges || {},
      workingHours: workingHours,
      isActive: stylist.isActive,
      styleIds: stylist.styles?.map(s => s.id) || [],
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingStylist(null);
    form.reset({
      fullName: "",
      email: "",
      phone: "",
      address: "",
      password: "",
      skillLevel: "Intermediate",
      isActive: true,
      styleIds: [],
      styleSurcharges: {},
      workingHours: undefined,
    });
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-charcoal">Stylists</h2>
          <p className="text-muted-foreground">Manage stylist profiles and availability.</p>
        </div>
        <Button onClick={openCreateDialog} className="bg-gold hover:bg-gold-dark text-white">
          <Plus className="mr-2 h-4 w-4" /> Add Stylist
        </Button>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search stylists..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Skill Level</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin inline" /> Loading...
                </TableCell>
              </TableRow>
            ) : stylists.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  {debouncedSearch ? "No stylists found matching your search." : "No stylists found. Add one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              stylists.map((stylist) => (
                <TableRow key={stylist.id}>
                  <TableCell className="font-medium">{stylist.fullName}</TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span>{stylist.email}</span>
                      <span className="text-muted-foreground">{stylist.phone}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{stylist.skillLevel}</Badge>
                  </TableCell>
                  <TableCell>
                    {stylist.isActive ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none">Active</Badge>
                    ) : (
                      <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-none">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(stylist)}
                      className="mr-2"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(stylist.id)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1 || isLoading}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <div className="text-sm font-medium">
          Page {page} of {totalPages}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages || isLoading}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Stylist Form Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col w-[95vw]">
          <DialogHeader>
            <DialogTitle>{editingStylist ? "Edit Stylist" : "Add New Stylist"}</DialogTitle>
            <DialogDescription>
              {editingStylist
                ? "Update the stylist's profile details."
                : "Create a new stylist account. They will use the email and password to login."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="jane@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="1234567890" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Salon St" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="skillLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Skill Level</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Junior">Junior</SelectItem>
                          <SelectItem value="Intermediate">Intermediate</SelectItem>
                          <SelectItem value="Senior">Senior</SelectItem>
                          <SelectItem value="Master">Master</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 
                 <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{editingStylist ? "New Password (Optional)" : "Password"}</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={editingStylist ? "Leave blank to keep current" : "******"} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {form.watch("fullName")?.toLowerCase().includes("victoria") && (
                  <FormField
                    control={form.control}
                    name="surcharge"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Surcharge ($)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" {...field} />
                        </FormControl>
                        <DialogDescription>Extra fee applied to bookings for this stylist (Victoria only).</DialogDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {editingStylist && (
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Active Status</FormLabel>
                        <DialogDescription>
                          Stylist can accept bookings and login
                        </DialogDescription>
                      </div>
                      <FormControl>
                        <div className="flex items-center space-x-2">
                           <Button
                             type="button"
                             variant={field.value ? "default" : "outline"}
                             size="sm"
                             onClick={() => field.onChange(true)}
                             className={field.value ? "bg-green-600 hover:bg-green-700" : ""}
                           >
                             Active
                           </Button>
                           <Button
                             type="button"
                             variant={!field.value ? "destructive" : "outline"}
                             size="sm"
                             onClick={() => field.onChange(false)}
                             className={!field.value ? "bg-red-600 hover:bg-red-700" : ""}
                           >
                             Inactive
                           </Button>
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
              />
              )}

              <FormField
                control={form.control}
                name="styleIds"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Capable Styles</FormLabel>
                      <DialogDescription>
                        Select the styles this stylist can perform.
                      </DialogDescription>
                    </div>
                    <div className="grid grid-cols-2 gap-2 border p-4 rounded-md h-40 overflow-y-auto">
                      {availableStyles.map((style) => (
                        <FormField
                          key={style.id}
                          control={form.control}
                          name="styleIds"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={style.id}
                                className="flex flex-row items-start space-x-3 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(style.id)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([...(field.value || []), style.id])
                                        : field.onChange(
                                            field.value?.filter(
                                              (value) => value !== style.id
                                            )
                                          )
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal">
                                  {style.name}
                                </FormLabel>
                              </FormItem>
                            )
                          }}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Working Hours Section */}
              <div className="space-y-4 pt-4 border-t">
                  <div className="mb-2">
                    <FormLabel className="text-base">Working Hours</FormLabel>
                    <DialogDescription>
                       Set specific working days and hours (overrides salon defaults).
                    </DialogDescription>
                  </div>
                  <div className="space-y-2 border p-4 rounded-md">
                    {DAYS.map((day) => (
                       <div key={day} className="flex items-center space-x-4">
                          <FormField
                            control={form.control}
                            name={`workingHours.${day}.isOpen`}
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-2 space-y-0 w-32">
                                    <FormControl>
                                        <Checkbox 
                                        checked={field.value ?? true} // Default to open if undefined
                                        onCheckedChange={(checked) => {
                                            field.onChange(checked);
                                            if (checked) {
                                                const startName = `workingHours.${day}.start` as const;
                                                const endName = `workingHours.${day}.end` as const;
                                                // @ts-ignore
                                                if (!form.getValues(startName)) form.setValue(startName, "09:00");
                                                // @ts-ignore
                                                if (!form.getValues(endName)) form.setValue(endName, "22:00");
                                            }
                                        }}
                                    />
                                    </FormControl>
                                    <FormLabel className="capitalize font-medium">{day}</FormLabel>
                                </FormItem>
                            )}
                          />
                          
                          {(form.watch(`workingHours.${day}.isOpen`) ?? true) && (
                              <>
                                <FormField
                                    control={form.control}
                                    name={`workingHours.${day}.start`}
                                    defaultValue="09:00"
                                    render={({ field }) => (
                                        <FormItem className="space-y-0">
                                            <FormControl>
                                                <Input type="time" className="w-24 h-8" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <span className="text-muted-foreground">-</span>
                                <FormField
                                    control={form.control}
                                    name={`workingHours.${day}.end`}
                                    defaultValue="22:00"
                                    render={({ field }) => (
                                        <FormItem className="space-y-0">
                                            <FormControl>
                                                <Input type="time" className="w-24 h-8" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                              </>
                          )}
                       </div>
                    ))}
                  </div>
              </div>

              {form.watch("fullName")?.toLowerCase().includes("victoria") && form.watch("styleIds")?.length > 0 && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="mb-2">
                    <FormLabel className="text-base">Style-Specific Surcharges</FormLabel>
                    <DialogDescription>
                       Set specific surcharge amounts for each style (overrides global surcharge).
                    </DialogDescription>
                  </div>
                  <div className="grid grid-cols-2 gap-4 max-h-40 overflow-y-auto p-1">
                    {availableStyles
                      .filter(s => form.watch("styleIds")?.includes(s.id))
                      .map(style => (
                        <FormField
                          key={`surcharge-${style.id}`}
                          control={form.control}
                          name={`styleSurcharges.${style.id}`}
                          render={({ field }) => (
                            <FormItem className="space-y-1">
                              <FormLabel className="text-xs font-normal truncate block" title={style.name}>
                                {style.name}
                              </FormLabel>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  min="0" 
                                  step="0.01" 
                                  placeholder="0.00" 
                                  {...field} 
                                  value={field.value ?? ""} 
                                  onChange={(e) => {
                                      const val = e.target.value;
                                      field.onChange(val === "" ? undefined : parseFloat(val));
                                  }}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="submit" className="bg-gold hover:bg-gold-dark text-white" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    editingStylist ? "Update Stylist" : "Create Stylist"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Stylists;