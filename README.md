# StayManager — Airbnb Booking Manager

A simple, single-file web app to manage short-stay rental bookings.

## Features
- **Dashboard** — upcoming check-ins, who's staying now, revenue, expenses & net profit
- **Calendar** — month view of bookings (colour-coded by source) and per-night prices
- **Bookings** — track source (Airbnb / Booking.com / VRBO / Direct), nights, guest details; double-booking protection
- **Expenses** — log costs by category and see real profit
- **Pricing** — default nightly rate plus per-date overrides
- **Monthly report** — printable / save-as-PDF statement
- **Calendar import (.ics)** — pull reservations from Airbnb / Booking.com / VRBO exports
- **Cloud sync** — optional Firebase sync to share live data across phone + computer
- **Backup / Restore** — export and import all data as a file

## Usage
Just open `index.html` in any browser. Data is saved in the browser (and synced to the cloud if you set that up).

No build step, no dependencies.
