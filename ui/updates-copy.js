import {localizedUpdates} from './localized-updates.js';
import {linuxUpdateCopy} from './linux-updates-copy.js';
export const updateCopy = {
  ...localizedUpdates,
  en: {
    checkUpdates:'Check for updates', automatic:'Check for app updates automatically', version:'Version',
    checking:'Checking for updates…', checkingBody:'Looking for the latest release.',
    currentTitle:'You’re up to date', currentBody:'You have the latest available version.',
    availableTitle:'A new version is ready', availableBody:'See what’s changed, then update whenever you’re ready. The app will close and reopen during installation.',
    errorTitle:'Update unavailable', errorBody:'Your current version is still ready to use.',
    downloadTitle:'Downloading your update', downloadBody:'Downloading and verifying the update. Keep this window open.',
    installTitle:'Installing your update', installBody:'The installer will reopen the app when it’s ready.',
    whatsNew:'Welcome to your new version', whatsNewBody:'Here’s what changed since your last version.',
    installed:'Installed', releaseNotes:'Release notes', noNotes:'No release notes were provided.',
    downloadProgress:'Update download progress', install:'Update and restart', later:'Later', close:'Close', retry:'Try again',
    signed:'Every update is verified with the publisher’s signing key before installation.',
    checkError:'Couldn’t reach the release service. Check your connection and try again. If this is a new repository, its first release may not be published yet.',
    installError:'The download, verification, or installation did not finish. Please try again. Finish any browser sign-in before updating.',
    downloading:'downloaded', available:'Update available',
  },
  el: {
    checkUpdates:'Έλεγχος ενημερώσεων', automatic:'Αυτόματος έλεγχος ενημερώσεων εφαρμογής', version:'Έκδοση',
    checking:'Έλεγχος ενημερώσεων…', checkingBody:'Αναζήτηση της νεότερης έκδοσης.',
    currentTitle:'Έχεις την τελευταία έκδοση', currentBody:'Χρησιμοποιείς την πιο πρόσφατη διαθέσιμη έκδοση.',
    availableTitle:'Μια νέα έκδοση είναι έτοιμη', availableBody:'Δες τις αλλαγές και ενημέρωσε όταν είσαι έτοιμος. Η εφαρμογή θα κλείσει και θα ανοίξει ξανά κατά την εγκατάσταση.',
    errorTitle:'Η ενημέρωση δεν είναι διαθέσιμη', errorBody:'Η τρέχουσα έκδοση παραμένει διαθέσιμη για χρήση.',
    downloadTitle:'Λήψη ενημέρωσης', downloadBody:'Λήψη και επαλήθευση ενημέρωσης. Κράτησε αυτό το παράθυρο ανοιχτό.',
    installTitle:'Εγκατάσταση ενημέρωσης', installBody:'Η εφαρμογή θα ανοίξει ξανά όταν ολοκληρωθεί η εγκατάσταση.',
    whatsNew:'Καλώς ήρθες στη νέα έκδοση', whatsNewBody:'Δες τι άλλαξε από την προηγούμενη έκδοσή σου.',
    installed:'Εγκατεστημένη', releaseNotes:'Αλλαγές έκδοσης', noNotes:'Δεν παρέχονται σημειώσεις έκδοσης.',
    downloadProgress:'Πρόοδος λήψης ενημέρωσης', install:'Ενημέρωση και επανεκκίνηση', later:'Αργότερα', close:'Κλείσιμο', retry:'Δοκίμασε ξανά',
    signed:'Κάθε ενημέρωση επαληθεύεται με το κλειδί υπογραφής του εκδότη πριν την εγκατάσταση.',
    checkError:'Δεν ήταν δυνατή η σύνδεση στην υπηρεσία εκδόσεων. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά. Σε νέο αποθετήριο ίσως δεν έχει δημοσιευτεί ακόμη η πρώτη έκδοση.',
    installError:'Η λήψη, η επαλήθευση ή η εγκατάσταση δεν ολοκληρώθηκε. Δοκίμασε ξανά. Ολοκλήρωσε πρώτα τυχόν σύνδεση στον browser.',
    downloading:'λήφθηκε', available:'Διαθέσιμη ενημέρωση',
  },
};
for (const [locale,copy] of Object.entries(linuxUpdateCopy)) Object.assign(updateCopy[locale],copy);
