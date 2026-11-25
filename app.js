// Startup file for cPanel Passenger.
import('./server.js').then(({start})=>start()).catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
