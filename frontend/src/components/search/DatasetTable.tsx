type Props = {
    rows: any[];
  };
  
  export default function DatasetTable({
    rows,
  }: Props) {
  
    return (
      <table border={1}>
  
        <thead>
          <tr>
  
            <th>Site</th>
  
            <th>pH</th>
  
            <th>Water Table</th>
  
            <th>Altitude</th>
  
          </tr>
        </thead>
  
        <tbody>
  
          {rows.slice(0,100).map(
            (row:any,index:number) => (
  
              <tr key={index}>
  
                <td>{row.sitename}</td>
  
                <td>{row.pH}</td>
  
                <td>{row.water_table_depth}</td>
  
                <td>{row.altitude}</td>
  
              </tr>
  
            )
          )}
  
        </tbody>
  
      </table>
    );
  }