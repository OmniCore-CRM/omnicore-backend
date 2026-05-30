-- Add widget-origin ticket activity actions for staging ticket visibility.
ALTER TYPE "TicketActivityAction" ADD VALUE 'TICKET_CREATED_FROM_WIDGET';
ALTER TYPE "TicketActivityAction" ADD VALUE 'MESSAGE_RECEIVED_ON_WIDGET';
