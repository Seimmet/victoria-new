import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isSameDay, isSameMonth, startOfDay } from "date-fns";
import { DayPicker } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { bookingService, Booking, TimeSlot } from "@/services/bookingService";
import { stylistService } from "@/services/stylistService";
import { authService } from "@/services/authService";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Calendar as CalendarIcon, DollarSign, CheckCircle, User } from "lucide-react";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Initialize Stripe safely
const getStripe = () => {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key || key === 'pk_test_PLACEHOLDER') return null;
  return loadStripe(key);
};

const STRIPE_FEE_PERCENTAGE = 0.035;

function StripePaymentForm({ amount, onSuccess }: { amount: number; onSuccess: (paymentIntentId: string) => void }) {
    const stripe = useStripe();
    const elements = useElements();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!stripe || !elements) {
            return;
        }

        setIsLoading(true);
        setErrorMessage(null);

        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                return_url: window.location.href, // Not used for redirect-less flow usually, but required
            },
            redirect: 'if_required'
        });

        if (error) {
            setErrorMessage(error.message || 'Payment failed');
            setIsLoading(false);
        } else if (paymentIntent && paymentIntent.status === 'succeeded') {
            onSuccess(paymentIntent.id);
        } else {
             setErrorMessage('Payment status: ' + (paymentIntent?.status || 'unknown'));
             setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <PaymentElement />
            {errorMessage && <div className="text-red-500 text-sm">{errorMessage}</div>}
            <Button type="submit" disabled={!stripe || isLoading} className="w-full">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Pay ${amount.toFixed(2)}
            </Button>
        </form>
    );
}

function RecordPaymentDialog({ booking, onRecordPayment }: { booking: Booking; onRecordPayment: (amount: number, method: 'cash' | 'stripe', stripePaymentId?: string) => void }) {
  // Filter out the initial deposit (assuming it's $50 or identified by status/type if possible, but based on requirement, deposit is separate)
  // We need to track "service payments" separate from "booking deposit".
  // Current logic: Sum all payments. 
  // New Logic: The $50 deposit is NOT part of service price.
  // So, Amount Due = Service Price - (Total Paid - Deposit).
  // OR simpler: We need to know which payments are for the service.
  // Assumption: The first payment of $50 is the deposit. Any subsequent payments are for the service.
  // Better yet, check amount. If amount == 50.00 and it was the first one, it's deposit.
  
  // Let's filter payments that are NOT the $50 deposit.
  // BUT, what if service is $50? 
  // Safest way: The requirement says "$50 is not deducted".
  // So Total Expected Payment = Service Price + $50 Deposit.
  // Total Paid so far = Sum of all payments.
  // Remaining Balance = (Service Price + 50) - Total Paid.
  // If Total Paid == 50 (just deposit), Remaining = Service Price.
  // If Total Paid > 50, Remaining = (Service Price + 50) - Total Paid.
  
  const totalPaid = booking.payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
  // Assume the first payment is the deposit if it exists, otherwise 0. 
  // We sort by ID to be safe, assuming sequential IDs.
  const sortedPayments = booking.payments ? [...booking.payments].sort((a, b) => a.id.localeCompare(b.id)) : [];
  const initialDeposit = sortedPayments.length > 0 ? Number(sortedPayments[0].amount) : 0;
  
  const servicePrice = Number(booking.price || 0); // Use price from booking object which includes adjustments
  
  // The customer must pay Service Price + Deposit in total.
  // Since Deposit is already paid (to book), they owe the Service Price.
  // If they made other payments, we deduct those.
  // effectively: Balance = Service Price - (TotalPaid - DepositAmount)
  // Which simplifies to: Balance = Service Price + DepositAmount - TotalPaid
  
  const remainingBalance = Math.max(0, (servicePrice + initialDeposit) - totalPaid);
  
  const [amount, setAmount] = useState(remainingBalance);
  const [method, setMethod] = useState<'cash' | 'stripe'>('cash');
  const [open, setOpen] = useState(false);
  
  // Stripe State
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isInitializingStripe, setIsInitializingStripe] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
      if (open) {
          // Recalculate based on current booking state
          const currentTotalPaid = booking.payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
          const currentPayments = booking.payments ? [...booking.payments].sort((a, b) => a.id.localeCompare(b.id)) : [];
          const currentDeposit = currentPayments.length > 0 ? Number(currentPayments[0].amount) : 0;
          
          setAmount(Math.max(0, (Number(booking.price || 0) + currentDeposit) - currentTotalPaid));
          setMethod('cash');
          setClientSecret(null);
      }
  }, [open, booking, servicePrice]);

  const handleCashSubmit = () => {
    onRecordPayment(amount, 'cash');
    setOpen(false);
  };

  const handleInitializeStripe = async () => {
      try {
          setIsInitializingStripe(true);
          // Calculate fee and total
          const processingFee = amount * STRIPE_FEE_PERCENTAGE;
          const totalCharge = amount + processingFee;
          // Convert to cents for Stripe
          const amountInCents = Math.round(totalCharge * 100);
          
          const { clientSecret } = await bookingService.createBookingPaymentIntent(booking.id, amountInCents);
          setClientSecret(clientSecret);
      } catch (error) {
          toast.error("Failed to initialize Stripe payment");
          console.error(error);
      } finally {
          setIsInitializingStripe(false);
      }
  };

  const handleStripeSuccess = (paymentIntentId: string) => {
      onRecordPayment(amount, 'stripe', paymentIntentId);
      setOpen(false);
      toast.success("Payment successful!");
  };

  // Calculate fee for display
  const processingFee = method === 'stripe' ? amount * STRIPE_FEE_PERCENTAGE : 0;
  const totalCharge = amount + processingFee;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
            <DollarSign className="h-4 w-4 mr-2" />
            Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] flex flex-col w-[95vw]">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Record the final payment for {booking.customer?.fullName || 'Guest'}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-1">
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Service</Label>
            <div className="col-span-3 font-medium">{booking.style?.name || booking.category?.name || 'Service'}</div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Service Price</Label>
            <div className="col-span-3">${servicePrice.toFixed(2)}</div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Booking Fee</Label>
            <div className="col-span-3 font-medium text-green-600">Paid ${initialDeposit.toFixed(2)}</div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Paid Towards Service</Label>
            <div className="col-span-3 text-green-600 font-medium">-${Math.max(0, totalPaid - initialDeposit).toFixed(2)}</div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="amount" className="text-right">
              Amount Due
            </Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="col-span-3"
              disabled={!!clientSecret} // Lock amount once stripe is initialized
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
             <Label className="text-right">Method</Label>
             <RadioGroup 
                value={method} 
                onValueChange={(v) => {
                    setMethod(v as 'cash' | 'stripe');
                    setClientSecret(null); // Reset stripe if method changes
                }} 
                className="col-span-3 flex gap-4"
                disabled={!!clientSecret}
             >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="cash" id="cash" />
                  <Label htmlFor="cash">Cash</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="stripe" id="stripe" />
                  <Label htmlFor="stripe">Stripe (Online)</Label>
                </div>
             </RadioGroup>
          </div>

          {method === 'stripe' && (
              <div className="bg-muted/50 p-3 rounded-md text-sm space-y-2 mt-2 col-span-4">
                  <div className="flex justify-between">
                      <span>Service Balance</span>
                      <span>${amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                      <span>Processing Fee (3.5%)</span>
                      <span>${processingFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2 mt-2">
                      <span>Total to Charge</span>
                      <span>${totalCharge.toFixed(2)}</span>
                  </div>
              </div>
          )}

          {/* Stripe Elements Area */}
          {method === 'stripe' && (
              <div className="col-span-4 mt-4 border-t pt-4">
                  {!clientSecret ? (
                      <Button onClick={handleInitializeStripe} disabled={isInitializingStripe || amount <= 0} className="w-full">
                          {isInitializingStripe ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Proceed to Payment (${totalCharge.toFixed(2)})
                      </Button>
                  ) : (
                      getStripe() ? (
                        <Elements stripe={getStripe()} options={{ clientSecret }}>
                            <StripePaymentForm amount={totalCharge} onSuccess={handleStripeSuccess} />
                        </Elements>
                      ) : (
                        <div className="text-center py-4 text-red-500">
                            Stripe is not configured.
                        </div>
                      )
                  )}
              </div>
          )}

        </div>
        </div>
        <DialogFooter>
          {method === 'cash' && (
             <Button type="submit" onClick={handleCashSubmit}>Confirm Cash Payment</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({ booking, onReschedule }: { booking: Booking; onReschedule: (date: string, time: string) => void }) {
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState<Date | undefined>(undefined);
    const [time, setTime] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [slots, setSlots] = useState<TimeSlot[]>([]);

    useEffect(() => {
        if (date && open) {
            const fetchAvailability = async () => {
                setLoading(true);
                try {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    const duration = booking.duration || 60;
                    const availableSlots = await bookingService.getAvailability(
                        dateStr,
                        booking.styleId || undefined,
                        booking.categoryId || undefined,
                        booking.stylistId || undefined,
                        duration,
                        booking.id
                    );
                    setSlots(availableSlots);
                } catch (error) {
                    console.error(error);
                    toast.error("Failed to load availability");
                } finally {
                    setLoading(false);
                }
            };
            fetchAvailability();
        } else {
            setSlots([]);
        }
    }, [date, open, booking]);

    const handleConfirm = () => {
        if (date && time) {
            const dateStr = format(date, 'yyyy-MM-dd');
            onReschedule(dateStr, time);
            setOpen(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline">Reschedule</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] max-h-[90vh] flex flex-col w-[95vw]">
                <DialogHeader>
                    <DialogTitle>Reschedule Appointment</DialogTitle>
                    <DialogDescription>
                        Select a new date and time for {booking.customer?.fullName || 'Guest'}.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto px-1">
                <div className="grid gap-4 py-4">
                    <div className="flex justify-center">
                        <Calendar
                            mode="single"
                            selected={date}
                            onSelect={(d) => { setDate(d); setTime(null); }}
                            disabled={(d) => d < startOfDay(new Date())}
                            className="rounded-md border shadow-sm"
                        />
                    </div>
                    {date && (
                        <div className="space-y-2">
                             <h4 className="font-medium text-sm">Available Times ({format(date, 'MMM d')})</h4>
                             {loading ? (
                                 <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                             ) : slots.length === 0 ? (
                                 <div className="text-center text-sm text-muted-foreground">No available slots for this date.</div>
                             ) : (
                                 <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
                                     {slots.map((slot) => (
                                         <Button
                                             key={slot.time}
                                             variant={time === slot.time ? "default" : "outline"}
                                             size="sm"
                                             onClick={() => setTime(slot.time)}
                                             disabled={!slot.available}
                                             className={!slot.available ? "opacity-50 cursor-not-allowed" : ""}
                                         >
                                             {format(parseISO(`2000-01-01T${slot.time}`), 'h:mm a')}
                                         </Button>
                                     ))}
                                 </div>
                             )}
                        </div>
                    )}
                </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={!date || !time}>Confirm</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function Bookings() {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const queryClient = useQueryClient();
  const currentUser = authService.getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';

  // Fetch all bookings
  const { data: bookings = [], isLoading: isLoadingBookings } = useQuery({
    queryKey: ["bookings"],
    queryFn: bookingService.getBookings,
  });

  // Fetch all stylists for assignment
  const { data: stylistsResponse, isLoading: isLoadingStylists } = useQuery({
    queryKey: ["stylists"],
    queryFn: () => stylistService.getAllStylists({ limit: 100 }),
  });

  const stylists = Array.isArray(stylistsResponse?.data) ? stylistsResponse.data : [];

  // Update Booking Mutation
  const updateBookingMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      bookingService.updateBooking(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Booking updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update booking");
    },
  });

  const formatBookingTimeDisplay = (bookingTime: string) => {
    try {
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(bookingTime)) {
        const [hh, mm] = bookingTime.split(":").map(Number);
        const d = new Date(0);
        d.setHours(hh, mm);
        return format(d, "h:mm a");
      }
      const d = new Date(bookingTime);
      const hours = d.getUTCHours();
      const minutes = d.getUTCMinutes();
      const local = new Date(0);
      local.setHours(hours, minutes);
      return format(local, "h:mm a");
    } catch {
      return bookingTime;
    }
  };

  const handleAssignStylist = (bookingId: string, stylistId: string) => {
    updateBookingMutation.mutate({ id: bookingId, data: { stylistId } });
  };

  const handleStatusChange = (bookingId: string, status: string) => {
    updateBookingMutation.mutate({ id: bookingId, data: { status } });
  };
  
  const handlePaymentStatusChange = (bookingId: string) => {
      updateBookingMutation.mutate({ id: bookingId, data: { paymentStatus: 'succeeded' } });
  }

  // Add Payment Mutation
  const addPaymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      bookingService.addPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Payment recorded successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to record payment");
    },
  });

  const handleRecordPayment = (bookingId: string, amount: number, method: 'cash' | 'stripe', stripePaymentId?: string) => {
      addPaymentMutation.mutate({ id: bookingId, data: { amount, method, stripePaymentId } });
  };

  const handleReschedule = (bookingId: string, date: string, time: string) => {
      updateBookingMutation.mutate({ id: bookingId, data: { date, time } });
  };

  // Filter bookings logic
  const getFilteredBookings = (type: 'upcoming' | 'completed') => {
    return bookings.filter((booking) => {
      const bookingDate = parseISO(booking.bookingDate);
      const isTodayOrFuture = bookingDate >= startOfDay(new Date());
      const isPast = bookingDate < startOfDay(new Date());
      const isCompletedOrCancelled = ['completed', 'cancelled'].includes(booking.status);

      if (date) {
        if (!isSameDay(bookingDate, date)) return false;
        if (type === 'upcoming') return !isCompletedOrCancelled;
        return isCompletedOrCancelled;
      }

      if (type === 'upcoming') return isTodayOrFuture && !isCompletedOrCancelled;
      return isPast || isCompletedOrCancelled;
    }).sort((a, b) => {
        const dateA = new Date(a.bookingDate + 'T' + a.bookingTime).getTime();
        const dateB = new Date(b.bookingDate + 'T' + b.bookingTime).getTime();
        return type === 'upcoming' ? dateA - dateB : dateB - dateA;
    });
  };

  const upcomingBookings = getFilteredBookings('upcoming');
  const completedBookings = getFilteredBookings('completed');

  const renderBookingCard = (booking: Booking) => (
    <Card key={booking.id} className="overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center">
        {/* Time & Status Strip */}
        <div className={`p-4 md:w-48 flex flex-col justify-center items-center md:items-start border-b md:border-b-0 md:border-r bg-muted/30`}>
          {!date && (
            <span className="text-sm font-medium text-muted-foreground mb-1">
                {format(parseISO(booking.bookingDate), "MMM d")}
            </span>
          )}
          <span className="text-2xl font-bold">
            {formatBookingTimeDisplay(booking.bookingTime)}
          </span>
          <Badge 
            variant="secondary" 
            className={`mt-2 ${getStatusColor(booking.status)}`}
          >
            {booking.status.toUpperCase()}
          </Badge>
        </div>

        {/* Booking Details */}
        <div className="p-4 flex-1 space-y-4 md:space-y-0 md:grid md:grid-cols-2 gap-4">
          <div>
            {booking.style && (
              <div className="text-sm font-semibold text-primary uppercase tracking-wide mb-1">
                {booking.style.name}
              </div>
            )}
            <h4 className="font-semibold text-lg">{booking.category?.name}</h4>
            {booking.promo && (
              <div className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                Promo: {booking.promo.title || 'Special Offer'} (
                {booking.promo.discountPercentage
                  ? `${booking.promo.discountPercentage}% off`
                  : `$${booking.promo.promoPrice} promo`}
                )
              </div>
            )}
            <div className="text-sm text-muted-foreground space-y-1 mt-1">
              <div className="flex items-center">
                <User className="h-4 w-4 mr-2" />
                {booking.customer?.fullName || 'Guest'}
              </div>
              <div className="pl-6">{booking.customer?.phone || 'No phone'}</div>
              <div className="pl-6">{booking.customer?.email || 'No email'}</div>
            </div>
            
             {/* Payment Summary */}
             <div className="mt-2 pt-2 border-t text-sm">
                <div className="flex justify-between items-center">
                   <span className="text-muted-foreground">Total Paid:</span>
                   <span className="font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                     ${(booking.payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0).toFixed(2)}
                   </span>
                </div>
             </div>
          </div>

          <div className="space-y-4">
             {/* Stylist Assignment */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Assigned Stylist
              </label>
              {isAdmin ? (
                <Select
                  value={booking.stylistId || "unassigned"}
                  onValueChange={(value) => handleAssignStylist(booking.id, value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select Stylist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {stylists.map((stylist: any) => (
                      <SelectItem key={stylist.id} value={stylist.id}>
                        {stylist.fullName || stylist.user?.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="p-2 border rounded-md bg-muted/50 text-sm font-medium">
                  {booking.stylist ? (booking.stylist.user?.fullName || "Assigned") : "Unassigned"}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
               {/* Status Actions */}
               {booking.status === 'booked' && (
                   <Button size="sm" variant="outline" onClick={() => handleStatusChange(booking.id, 'in_progress')}>
                       Start Appointment
                   </Button>
               )}
               {booking.status === 'in_progress' && (
                   <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => handleStatusChange(booking.id, 'completed')}>
                       <CheckCircle className="h-4 w-4 mr-2" />
                       Mark Complete
                   </Button>
               )}
               
               {/* Payment Action */}
               {booking.status === 'completed' && (
                   <div className="flex items-center gap-2">
                       {(() => {
                           const totalPaid = booking.payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
                           // Assume first payment is deposit
                           const initialDeposit = booking.payments && booking.payments.length > 0 
                                ? Number([...booking.payments].sort((a, b) => a.id.localeCompare(b.id))[0].amount) 
                                : 0;
                           const targetTotal = Number(booking.price || 0) + initialDeposit;
                           
                           return totalPaid >= targetTotal - 0.01 ? ( // tolerance for float
                               <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Paid in Full</Badge>
                           ) : (
                               <RecordPaymentDialog 
                                    booking={booking} 
                                    onRecordPayment={(amount, method, stripePaymentId) => handleRecordPayment(booking.id, amount, method, stripePaymentId)} 
                               />
                           );
                       })()}
                   </div>
               )}
               
               {booking.status !== 'cancelled' && booking.status !== 'completed' && (
                   <>
                     <RescheduleDialog 
                         booking={booking} 
                         onReschedule={(date, time) => handleReschedule(booking.id, date, time)} 
                     />
                     <AlertDialog>
                       <AlertDialogTrigger asChild>
                         <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50">
                             Cancel
                         </Button>
                       </AlertDialogTrigger>
                       <AlertDialogContent className="max-h-[90vh] w-[95vw] sm:max-w-lg flex flex-col">
                         <div className="flex-1 overflow-y-auto px-1">
                           <AlertDialogHeader>
                             <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                             <AlertDialogDescription>
                               This action will cancel the booking. This cannot be easily undone.
                             </AlertDialogDescription>
                           </AlertDialogHeader>
                         </div>
                         <AlertDialogFooter>
                           <AlertDialogCancel>Dismiss</AlertDialogCancel>
                           <AlertDialogAction onClick={() => handleStatusChange(booking.id, 'cancelled')} className="bg-red-600 hover:bg-red-700">
                             Yes, Cancel Booking
                           </AlertDialogAction>
                         </AlertDialogFooter>
                       </AlertDialogContent>
                     </AlertDialog>
                   </>
               )}

               {booking.status === 'cancelled' && (
                   <Button size="sm" variant="outline" onClick={() => handleStatusChange(booking.id, 'booked')}>
                       Restore to Booked
                   </Button>
               )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );

  // Get days with bookings for calendar modifiers
  const bookedDays = bookings.map((b) => parseISO(b.bookingDate));

  const getStatusColor = (status: string) => {
    switch (status) {
      case "booked":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "checked_in":
        return "bg-teal-100 text-teal-800 border-teal-200";
      case "in_progress":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "cancelled":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (isLoadingBookings || isLoadingStylists) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Bookings Management</h2>
        <p className="text-muted-foreground">
          View and manage customer appointments.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Calendar View */}
        <div className="md:col-span-4 lg:col-span-3">
          <Card>
            <CardContent className="p-0">
              <DayPicker
                mode="single"
                selected={date}
                onSelect={setDate}
                month={currentMonth}
                onMonthChange={setCurrentMonth}
                className="p-3 w-full flex justify-center"
                modifiers={{
                    booked: bookedDays
                }}
                modifiersStyles={{
                    booked: { fontWeight: 'bold', textDecoration: 'underline', color: 'var(--primary)' }
                }}
              />
            </CardContent>
          </Card>
          
          <div className="mt-4 space-y-2">
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">Legend</h3>
             <div className="flex items-center text-sm">
                <span className="w-3 h-3 bg-yellow-100 border border-yellow-200 rounded-full mr-2"></span>
                <span>Booked</span>
             </div>
             <div className="flex items-center text-sm">
                <span className="w-3 h-3 bg-blue-100 border border-blue-200 rounded-full mr-2"></span>
                <span>In Progress</span>
             </div>
             <div className="flex items-center text-sm">
                <span className="w-3 h-3 bg-green-100 border border-green-200 rounded-full mr-2"></span>
                <span>Completed</span>
             </div>
          </div>
        </div>

        {/* Bookings List */}
        <div className="md:col-span-8 lg:col-span-9 space-y-4">
          <Tabs defaultValue="upcoming" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="upcoming">
                Upcoming ({upcomingBookings.length})
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed ({completedBookings.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upcoming" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">
                  {date ? format(date, "MMMM d, yyyy") : `Upcoming Bookings`}
                </h3>
              </div>
              
              {upcomingBookings.length === 0 ? (
                <Card className="bg-muted/50 border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <CalendarIcon className="h-12 w-12 mb-4 opacity-50" />
                    <p>No upcoming bookings found{date ? " for this date" : ""}.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {upcomingBookings.map(renderBookingCard)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="completed" className="space-y-4">
               <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">
                  {date ? format(date, "MMMM d, yyyy") : `Completed Bookings`}
                </h3>
              </div>
              
              {completedBookings.length === 0 ? (
                <Card className="bg-muted/50 border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mb-4 opacity-50" />
                    <p>No completed bookings found{date ? " for this date" : ""}.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {completedBookings.map(renderBookingCard)}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
