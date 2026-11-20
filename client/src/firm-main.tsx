// Entry of the firm build (client/firm.html). Order matters: the registration module must run
// before main.tsx reads the static root.
import "./firm-register";
import "./main";
