import mysql from 'mysql2/promise';

export const initialState = () => ({
  users:[], clients:[], checks:[], parties:[], directors:[],
  services:[{id:'audit',key:'audit',name:'Audit & Assurance'},{id:'tax',key:'tax',name:'Tax'},{id:'advisory',key:'advisory',name:'Advisory'}],
  types:[], next:1, version:0, credentials:{}, sessions:{}, tokens:{}, audit:[], deliveries:{}
});

export function connect(env=process.env) {
  const {DB_HOST='127.0.0.1', DB_PORT='3306', DB_NAME, DB_USER, DB_PASSWORD}=env;
  if(!DB_NAME||!DB_USER||DB_PASSWORD===undefined) throw Error('Configure DB_NAME, DB_USER and DB_PASSWORD.');
  const pool=mysql.createPool({host:DB_HOST,port:Number(DB_PORT),database:DB_NAME,user:DB_USER,
    password:DB_PASSWORD,connectionLimit:8,timezone:'Z',
    ssl:env.DB_TLS==='true'?{rejectUnauthorized:true}:undefined});
  const decode = row => {
    if(!row) throw Error('Database is empty. Run npm run migrate.');
    return typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
  };
  return {
    async migrate() {
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_state (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY, payload JSON NOT NULL
      ) ENGINE=InnoDB`);
      await pool.execute('INSERT INTO workspace_state (id,payload) VALUES (1,?) ON DUPLICATE KEY UPDATE id=id',[JSON.stringify(initialState())]);
    },
    async read() {
      const [[row]]=await pool.query('SELECT payload FROM workspace_state WHERE id=1');
      return decode(row);
    },
    async write(operation) {
      const conn=await pool.getConnection();
      try{
        await conn.beginTransaction();
        const [[row]]=await conn.query('SELECT payload FROM workspace_state WHERE id=1 FOR UPDATE');
        const state=decode(row);
        const result=await operation(state);
        await conn.execute('UPDATE workspace_state SET payload=? WHERE id=1',[JSON.stringify(state)]);
        await conn.commit();
        return result;
      }catch(error){
        await conn.rollback();
        throw error;
      }finally{conn.release();}
    },
    close:()=>pool.end()
  };
}
